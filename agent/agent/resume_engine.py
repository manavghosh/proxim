"""LiteLLM-powered resume personalisation engine for the Resume Builder Agent (F10)."""
from __future__ import annotations

import json
import re
import structlog

from agent.models import PersonalisedResume, CoverLetterContent, KeywordSet
from agent.archetype_registry import ArchetypeConfig

logger = structlog.get_logger()


def _get_api_key(settings) -> str:
    if settings.llm_provider == "gemini":
        return settings.gemini_api_key
    return settings.anthropic_api_key


def _call_llm(prompt: str, settings) -> str:
    import litellm
    response = litellm.completion(
        model=f"{settings.llm_provider}/{settings.llm_model}",
        api_key=_get_api_key(settings),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=4096,
    )
    raw = response.choices[0].message.content or ""
    raw = re.sub(r'^```(?:json)?\s*\n?', '', raw.strip())
    raw = re.sub(r'\n?```\s*$', '', raw).strip()
    return raw


def personalise_resume(
    job: dict,
    parsed_profile: dict,
    archetype_config: ArchetypeConfig,
    keywords: list[str],
    settings,
) -> PersonalisedResume:
    """Call LLM to personalise the resume for the detected archetype."""
    prompt = f"""You are a senior career writer personalising a resume for a specific job.

CRITICAL RULES — MUST FOLLOW:
1. ALL job titles, company names, employment dates, quantified metrics, patent numbers MUST be VERBATIM from the source profile. Never alter them.
2. Reorder and reframe existing proof points per the archetype — do NOT fabricate any new credentials.
3. Naturally incorporate these keywords where appropriate: {json.dumps(keywords)}

## Target Archetype
Name: {archetype_config.name}
Section order: {archetype_config.section_order}
Lead proof point types: {archetype_config.lead_proof_point_types}
Tone: {archetype_config.tone}

## Source Candidate Profile (source of truth)
{json.dumps(parsed_profile, indent=2)}

## Target Job
Title: {job.get('title')}
Company: {job.get('company')}
JD: {str(job.get('jd_raw', ''))[:2000]}

## Required JSON Output
{{
  "summary": "<3-5 sentence archetype-targeted professional summary>",
  "roles": [
    {{
      "title": "<VERBATIM from profile>",
      "company": "<VERBATIM from profile>",
      "dates": "<VERBATIM from profile — e.g. '2020 — Present'>",
      "bullets": ["<reframed bullet — keyword-aware, no new metrics>"]
    }}
  ],
  "skills": ["<skill from profile>"],
  "proof_points": ["<OSS/patent/publication VERBATIM from profile>"],
  "coherence_ok": false
}}"""

    raw = _call_llm(prompt, settings)
    parsed = json.loads(raw)
    return PersonalisedResume.model_validate(parsed)


def self_review(
    job: dict,
    personalised: PersonalisedResume,
    parsed_profile: dict,
    settings,
) -> tuple[bool, str]:
    """Ask the LLM to check factual integrity of the personalised resume."""
    prompt = f"""You are a factual integrity auditor reviewing a personalised resume.

Check: does the personalised resume contain ANY information NOT present verbatim in the source profile?
Specifically check: job titles, company names, dates, numeric metrics, patent numbers.

## Source Profile (ground truth)
{json.dumps(parsed_profile, indent=2)}

## Personalised Resume to Audit
{json.dumps(personalised.model_dump(), indent=2)}

Respond with JSON:
{{
  "coherence_ok": <true if all factual claims are verbatim from source, false if any fabrication found>,
  "feedback": "<brief explanation of any issues found, or 'All factual claims verified' if clean>"
}}"""

    raw = _call_llm(prompt, settings)
    parsed = json.loads(raw)
    return bool(parsed.get("coherence_ok", False)), str(parsed.get("feedback", ""))


def generate_cover_letter(
    job: dict,
    parsed_profile: dict,
    archetype_config: ArchetypeConfig,
    settings,
) -> CoverLetterContent:
    """Generate a 3-section cover letter tailored to the job and archetype."""
    prompt = f"""You are a career writer crafting a one-page cover letter.

Archetype tone: {archetype_config.tone}
Emphasis themes: {archetype_config.keywords_emphasis}

## Candidate Profile
{json.dumps(parsed_profile, indent=2)}

## Job
Title: {job.get('title')}
Company: {job.get('company')}
JD excerpt: {str(job.get('jd_raw', ''))[:1500]}

Write a compelling, authentic cover letter. Use JD-derived content for company research.

Respond with JSON:
{{
  "opening": "<1 strong opening paragraph — reference job title and company>",
  "body": "<2-3 paragraphs: value proposition, key achievements, why this role>",
  "closing": "<1 closing paragraph with call to action>",
  "company_research_used": false
}}"""

    raw = _call_llm(prompt, settings)
    parsed = json.loads(raw)
    return CoverLetterContent.model_validate(parsed)


def extract_keywords(jd_raw: str, settings) -> KeywordSet:
    """Extract 15–20 high-signal ATS keywords from the JD."""
    prompt = f"""Extract 15–20 high-signal ATS keywords from this job description.
Focus on: technical skills, domain expertise, leadership terms, methodologies.
Exclude generic words like "experience", "team", "work".

Job Description:
{jd_raw[:3000]}

Respond with JSON:
{{
  "keywords": ["keyword1", "keyword2", ...]
}}
Return exactly 15–20 keywords as strings in the array."""

    for attempt in range(2):
        try:
            raw = _call_llm(prompt, settings)
            parsed = json.loads(raw)
            kws = parsed.get("keywords", [])
            return KeywordSet(keywords=kws)
        except Exception as e:
            if attempt == 1:
                raise ValueError(f"Keyword extraction failed after 2 attempts: {e}") from e
    raise ValueError("Keyword extraction failed")


def inject_keywords(personalised: PersonalisedResume, keywords: list[str]) -> PersonalisedResume:
    """Inject keywords naturally into the resume — max 3 occurrences each, no factual field alteration."""
    if not keywords:
        return personalised

    full_text = (personalised.summary + " " +
                 " ".join(b for r in personalised.roles for b in r.bullets) +
                 " " + " ".join(personalised.skills)).lower()

    injected_count: dict[str, int] = {}
    for kw in keywords:
        kw_lower = kw.lower()
        injected_count[kw_lower] = full_text.count(kw_lower)

    # Append missing keywords to skills if under 3 occurrences
    updated_skills = list(personalised.skills)
    for kw in keywords:
        kw_lower = kw.lower()
        if injected_count.get(kw_lower, 0) < 3:
            already_in_skills = any(kw_lower in s.lower() for s in updated_skills)
            if not already_in_skills and len(updated_skills) < 25:
                updated_skills.append(kw)
                injected_count[kw_lower] = injected_count.get(kw_lower, 0) + 1

    return personalised.model_copy(update={"skills": updated_skills})
