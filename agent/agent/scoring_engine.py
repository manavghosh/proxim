"""Scoring engine — LiteLLM 10D scoring with self-repair retry and deterministic grade computation."""
from __future__ import annotations

import json
import re
import structlog
from pydantic import ValidationError

from agent.models import JobScoreOutput, ScoreReport

logger = structlog.get_logger()


def _get_api_key(settings) -> str:
    """Return the API key for the configured provider."""
    if settings.llm_provider == "gemini":
        return settings.gemini_api_key
    return settings.anthropic_api_key

# Weight per weighted dimension (gate dims excluded from weighted average)
DIMENSION_WEIGHTS: dict[str, int] = {
    "compensation":          3,
    "company_stage":         3,
    "interview_probability": 3,
    "thought_leadership":    2,
    "geography":             2,
    "growth_trajectory":     2,
    "domain_resonance":      2,
    "hiring_urgency":        1,
}
TOTAL_WEIGHT: int = sum(DIMENSION_WEIGHTS.values())  # 18

GATE_FAIL_THRESHOLD: float = 2.5
MAX_RETRIES: int = 2

ARCHETYPES = [
    "Enterprise Chief AI Officer",
    "Startup CTO/VP",
    "Agentic Systems Architect",
    "GCC AI Practice Head",
    "AI Thought Leader",
]


def truncate_jd(jd_text: str, max_words: int = 4000) -> str:
    """Truncate JD to max_words for prompt construction."""
    words = jd_text.split()
    if len(words) <= max_words:
        return jd_text
    return " ".join(words[:max_words]) + "\n\n[...truncated]"


def compute_weighted_score(weighted_scores: dict[str, float]) -> float:
    """Compute the weighted average of the 8 weighted dimensions. Round to 1 decimal."""
    total = sum(weighted_scores[dim] * DIMENSION_WEIGHTS[dim] for dim in DIMENSION_WEIGHTS)
    return round(total / TOTAL_WEIGHT, 1)


def score_to_grade(numeric_score: float, gate_failed: bool) -> str:
    """Map numeric score and gate result to letter grade A/B/C/D/E/F.

    Bands:
      A ≥ 4.5   excellent fit
      B ≥ 4.0   good fit
      C ≥ 3.0   moderate fit
      D ≥ 2.0   weak but viable
      E ≥ 1.0   poor — gates passed but most weighted dimensions scored low
      F         either a hard gate failure OR weighted score below 1.0
    """
    if gate_failed:
        return "F"
    if numeric_score >= 4.5:
        return "A"
    if numeric_score >= 4.0:
        return "B"
    if numeric_score >= 3.0:
        return "C"
    if numeric_score >= 2.0:
        return "D"
    if numeric_score >= 1.0:
        return "E"
    return "F"


def _build_scoring_prompt(job: dict, parsed_profile: dict, preferences: dict) -> str:
    jd = truncate_jd(job.get("jd_raw", ""))
    seniority = preferences.get("seniority_levels", [])
    geo = preferences.get("geographic_preference", [])
    comp = preferences.get("compensation_band", {})
    stage = preferences.get("company_stages", [])
    # Limit profile to key fields to keep prompt size manageable
    compact_profile = {
        "name":         parsed_profile.get("name", ""),
        "summary":      parsed_profile.get("summary", "")[:500],
        "roles":        parsed_profile.get("roles", [])[:5],
        "skills":       parsed_profile.get("skills", [])[:20],
        "patents":      parsed_profile.get("patents", [])[:5],
        "projects":     parsed_profile.get("projects", [])[:3],
    }
    profile_str = json.dumps(compact_profile, indent=2)
    archetype_list = "\n".join(f"  - {a}" for a in ARCHETYPES)

    return f"""You are a senior career analyst scoring a job opportunity for a senior IT professional.

## Candidate Preferences
- Target seniority levels: {seniority}
- Geographic preference: {geo}
- Target compensation band: {comp}
- Preferred company stages: {stage}

## Candidate Parsed Profile
{profile_str}

## Job to Score
Title: {job.get("title", "")}
Company: {job.get("company", "")}

### Job Description
{jd}

## Scoring Instructions

Evaluate across exactly 10 dimensions. Return JSON matching the schema below.

### Gate-Pass Dimensions (score 1.0–5.0 each):
1. role_level_match: Does the seniority/title match the candidate's target level? Score < 2.5 = disqualified.
2. ai_stack_alignment: Does the tech stack (LangGraph, MCP, LLMs, agentic AI) align? Score < 2.5 = disqualified.

### Weighted Dimensions (score 1.0–5.0 each):
3. compensation (weight 3): Does implied/stated compensation match the target band?
4. company_stage (weight 3): Does the company stage match candidate preference?
5. interview_probability (weight 3): Estimated callback likelihood given profile strength.
6. thought_leadership (weight 2): Do OSS projects, patents, publishing amplify fit?
7. geography (weight 2): Is remote/hybrid feasible from Bengaluru?
8. growth_trajectory (weight 2): Visible path toward Chief AI Officer/CTO level?
9. domain_resonance (weight 2): Problem domain alignment with candidate interest?
10. hiring_urgency (weight 1): Speed signals — posting recency, urgency language.

### Archetype Detection
Identify which archetype this job targets:
{archetype_list}

## Required JSON Output
{{
  "gate": {{
    "role_level_match": {{"score": <1.0-5.0>, "reasoning": "<2-3 sentences>"}},
    "ai_stack_alignment": {{"score": <1.0-5.0>, "reasoning": "<2-3 sentences>"}}
  }},
  "weighted": {{
    "compensation": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "company_stage": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "interview_probability": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "thought_leadership": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "geography": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "growth_trajectory": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "domain_resonance": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "hiring_urgency": {{"score": <1.0-5.0>, "reasoning": "<1-2 sentences>"}}
  }},
  "numeric_score": <computed weighted average>,
  "grade": "<A|B|C|D|F>",
  "archetype": "<one of the 5 archetypes>",
  "archetype_confidence": <0.0-1.0>
}}"""


def _build_report_prompt(job: dict, parsed_profile: dict, score_output: JobScoreOutput) -> str:
    jd = truncate_jd(job.get("jd_raw", ""))
    profile_str = json.dumps(parsed_profile, indent=2)

    return f"""You are a career analyst writing a structured match report for a senior candidate.

CRITICAL RULE: In Block B (CV Match), cite ONLY proof points that appear verbatim in the candidate profile below.
Do NOT invent, infer, or extrapolate any titles, company names, dates, metrics, or patent numbers.

## Candidate Profile (source of truth for all proof points)
{profile_str}

## Job
Title: {job.get("title")}
Company: {job.get("company")}

### Job Description
{jd}

## Score Summary
Grade: {score_output.grade} ({score_output.numeric_score})
Archetype: {score_output.archetype}

## Required JSON Output

IMPORTANT: Every value below MUST be a plain string. Never use JSON arrays or nested objects.
For multi-line content use newlines (\\n) inside the string.

{{
  "block_a": "<Executive Summary: 1 paragraph — grade, key strengths, primary risk>",
  "block_b": "<CV Match: markdown table string 'JD Requirement | Candidate Proof Point | Strength'. Each proof point MUST be verbatim from parsed profile.>",
  "block_c": "<Gaps & Mitigation: plain string using '- Critical: ...' and '- Minor: ...' lines for each gap and its mitigation>",
  "block_d": "<Level & Positioning: plain string — detected seniority, recommended archetype, positioning notes>",
  "block_e": "<Compensation Analysis: plain string — JD range vs target, market context, negotiability signal>",
  "block_f": "<Interview Probability: plain string — estimated callback %, key differentiators, likely interview topics>"
}}"""


async def score_job(
    job: dict,
    parsed_profile: dict,
    preferences: dict,
) -> JobScoreOutput:
    """Score a single job using LiteLLM. Self-repair retry on Pydantic validation failure."""
    import litellm
    from agent.config import settings

    prompt = _build_scoring_prompt(job, parsed_profile, preferences)
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            response = litellm.completion(
                model=f"{settings.llm_provider}/{settings.llm_model}",
                api_key=_get_api_key(settings),
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=4096,
            )
            raw = response.choices[0].message.content

            # Strip markdown code fencing that some models add despite response_format
            if raw:
                raw = re.sub(r'^```(?:json)?\s*\n?', '', raw.strip())
                raw = re.sub(r'\n?```\s*$', '', raw).strip()

            # Guard: empty/None content means the model didn't return JSON
            if not raw or not raw.strip():
                finish_reason = response.choices[0].finish_reason
                raise ValueError(
                    f"Empty response from LLM (finish_reason={finish_reason}). "
                    "JD may be too long — will retry with truncated prompt."
                )

            parsed, _ = json.JSONDecoder().raw_decode(raw.strip())


            # Recompute grade + score deterministically — do not trust the LLM's values
            gate_failed = (
                parsed["gate"]["role_level_match"]["score"] < GATE_FAIL_THRESHOLD
                or parsed["gate"]["ai_stack_alignment"]["score"] < GATE_FAIL_THRESHOLD
            )
            weighted_scores = {k: parsed["weighted"][k]["score"] for k in DIMENSION_WEIGHTS}
            numeric_score = compute_weighted_score(weighted_scores)
            grade = score_to_grade(numeric_score, gate_failed)

            parsed["numeric_score"] = numeric_score
            parsed["grade"] = grade

            return JobScoreOutput.model_validate(parsed)

        except Exception as e:
            last_error = e
            error_str = str(e)
            is_rate_limit = "rate" in error_str.lower() or "429" in error_str or "RateLimitError" in type(e).__name__

            if attempt < MAX_RETRIES:
                # Back off longer on rate limits, shorter on parse errors
                wait = 60 if is_rate_limit else 5
                logger.warning("score_retry",
                               job_id=job.get("id"), attempt=attempt,
                               error=error_str, wait_seconds=wait,
                               reason="rate_limit" if is_rate_limit else "parse_error")
                import asyncio
                await asyncio.sleep(wait)
            else:
                logger.warning("score_retry",
                               job_id=job.get("id"), attempt=attempt, error=error_str)

    raise RuntimeError(
        f"Scoring failed after {MAX_RETRIES + 1} attempts for job {job.get('id')}: {last_error}"
    )


async def generate_report(
    job: dict,
    parsed_profile: dict,
    score_output: JobScoreOutput,
) -> ScoreReport:
    """Generate the 6-block report. Block A only for F-grade jobs."""
    import litellm
    from agent.config import settings

    if score_output.grade == "F":
        summary_prompt = (
            f"Write a one-paragraph executive summary explaining why this job received an F grade.\n"
            f"Job: {job.get('title')} at {job.get('company')}\n"
            f"Gate scores: role_level_match={score_output.gate.role_level_match.score}, "
            f"ai_stack_alignment={score_output.gate.ai_stack_alignment.score}\n"
            f'Return JSON: {{"block_a": "<paragraph>"}}'
        )
        response = litellm.completion(
            model=f"{settings.llm_provider}/{settings.llm_model}",
            api_key=_get_api_key(settings),
            messages=[{"role": "user", "content": summary_prompt}],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        raw_f = response.choices[0].message.content or ""
        raw_f = re.sub(r'^```(?:json)?\s*\n?', '', raw_f.strip())
        raw_f = re.sub(r'\n?```\s*$', '', raw_f).strip()
        data, _ = json.JSONDecoder().raw_decode(raw_f.strip())
        return ScoreReport(
            block_a=data["block_a"],
            block_b="", block_c="", block_d="", block_e="", block_f="",
        )

    prompt = _build_report_prompt(job, parsed_profile, score_output)
    response = litellm.completion(
        model=f"{settings.llm_provider}/{settings.llm_model}",
        api_key=_get_api_key(settings),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    raw_r = response.choices[0].message.content or ""
    raw_r = re.sub(r'^```(?:json)?\s*\n?', '', raw_r.strip())
    raw_r = re.sub(r'\n?```\s*$', '', raw_r).strip()
    data, _ = json.JSONDecoder().raw_decode(raw_r.strip())
    return ScoreReport.model_validate(data)
