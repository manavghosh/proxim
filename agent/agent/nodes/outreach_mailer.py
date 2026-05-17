"""Outreach Mailer LangGraph nodes (F6).

State machine: pending_discovery → discovering → generating → pending_approval
Terminal exits: email_not_found | low_confidence | failed
"""
from __future__ import annotations

import re
import structlog
from typing import TypedDict, Optional

import litellm
from pydantic import BaseModel, field_validator, model_validator

from agent import hunter_io
from agent.db_sqlite import (
    insert_email_drafts,
    update_email_cadence,
)

logger = structlog.get_logger(__name__)


# ── State ──────────────────────────────────────────────────────────────────────

class OutreachMailerState(TypedDict):
    job_id: str
    candidate_id: str
    company: str
    job_title: str
    archetype: str
    archetype_confidence: float
    hiring_manager_name: Optional[str]
    cadence_id: Optional[str]
    discovered_email: Optional[str]
    email_confidence: Optional[int]
    email_source: Optional[str]
    subject: Optional[str]
    day1_body: Optional[str]
    day3_body: Optional[str]
    day7_body: Optional[str]
    generation_attempts: int
    status: str
    error: Optional[str]


# ── Pydantic validators ────────────────────────────────────────────────────────

def _word_count(text: str) -> int:
    return len(text.split())


def _validate_day3_body(v: str) -> str:
    forbidden = ["following up", "checking in", "just following", "just checking"]
    for phrase in forbidden:
        if phrase.lower() in v.lower():
            raise ValueError(f"Forbidden phrase in Day 3 draft: '{phrase}'")
    if _word_count(v) > 100:
        raise ValueError(f"Day 3 draft exceeds 100 words ({_word_count(v)})")
    return v


def _validate_day7_body(v: str) -> str:
    pressure = ["last chance", "final follow-up", "urgent", "time-sensitive"]
    for phrase in pressure:
        if phrase.lower() in v.lower():
            raise ValueError(f"Pressure phrase in Day 7 draft: '{phrase}'")
    if _word_count(v) > 80:
        raise ValueError(f"Day 7 draft exceeds 80 words ({_word_count(v)})")
    return v


class EmailDraftOutput(BaseModel):
    subject: str
    day1_body: str
    day3_body: str
    day7_body: str

    @field_validator("day1_body")
    @classmethod
    def validate_day1(cls, v: str) -> str:
        if _word_count(v) > 150:
            raise ValueError(f"Day 1 draft exceeds 150 words ({_word_count(v)})")
        return v

    @field_validator("day3_body")
    @classmethod
    def validate_day3(cls, v: str) -> str:
        return _validate_day3_body(v)

    @field_validator("day7_body")
    @classmethod
    def validate_day7(cls, v: str) -> str:
        return _validate_day7_body(v)


class SelfReviewResult(BaseModel):
    passes: bool
    feedback: str


# ── LiteLLM helpers (patched in tests) ────────────────────────────────────────

def _model_string(settings) -> str:
    """Build the LiteLLM model string: 'provider/model' (matches scoring_engine pattern)."""
    return f"{settings.llm_provider}/{settings.llm_model}"


def _strip_markdown(text: str) -> str:
    """Strip ```json ... ``` fencing that some models add despite response_format."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[: text.rfind("```")]
    return text.strip()


def _api_key(settings) -> str:
    """Return the API key for the configured LLM provider."""
    if settings.llm_provider == "gemini":
        return settings.gemini_api_key
    return settings.anthropic_api_key


async def litellm_generate(state: OutreachMailerState, settings) -> EmailDraftOutput:
    import json

    prompt = (
        f"You are a professional career coach writing outreach emails for a job seeker.\n"
        f"Write a 3-email cadence to a hiring manager at {state['company']}.\n"
        f"Role applied for: {state['job_title']}\n"
        f"Candidate profile: {state['archetype']}\n"
        f"Hiring manager name: {state.get('hiring_manager_name') or 'the hiring manager'}\n\n"
        "Rules:\n"
        "- day1_body: introduce the candidate, mention something specific about the company, max 150 words\n"
        "- day3_body: add a specific value insight relevant to their work, max 100 words, "
        "do NOT use phrases: 'following up', 'checking in', 'just following', 'just checking'\n"
        "- day7_body: gentle close, leave door open, max 80 words, "
        "no pressure phrases like 'last chance', 'urgent', 'final'\n"
        "- subject: one concise subject line for all three emails\n\n"
        'Return ONLY valid JSON: {"subject": "...", "day1_body": "...", "day3_body": "...", "day7_body": "..."}'
    )

    resp = await litellm.acompletion(
        model=_model_string(settings),
        api_key=_api_key(settings),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    raw = _strip_markdown(resp.choices[0].message.content or "")
    data = json.loads(raw)
    return EmailDraftOutput(**data)


async def litellm_self_review(draft: EmailDraftOutput, settings) -> SelfReviewResult:
    import json

    prompt = (
        "You are a professional recruiter reviewing outreach emails.\n"
        "Would a senior human professional send these emails to a hiring manager?\n"
        "Check: personalisation, tone, value-proposition clarity, absence of spam signals.\n\n"
        f"Subject: {draft.subject}\n"
        f"Day 1 ({_word_count(draft.day1_body)} words): {draft.day1_body}\n"
        f"Day 3 ({_word_count(draft.day3_body)} words): {draft.day3_body}\n"
        f"Day 7 ({_word_count(draft.day7_body)} words): {draft.day7_body}\n\n"
        'Return ONLY valid JSON: {"passes": true, "feedback": "brief comment"}'
    )

    resp = await litellm.acompletion(
        model=_model_string(settings),
        api_key=_api_key(settings),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    raw = _strip_markdown(resp.choices[0].message.content or "")
    data = json.loads(raw)
    return SelfReviewResult(**data)


# ── Nodes ──────────────────────────────────────────────────────────────────────

async def discover_email_node(state: OutreachMailerState, config) -> OutreachMailerState:
    """Hunter.io two-pass email discovery."""
    pool = config["configurable"]["pool"]
    settings = config["configurable"]["settings"]
    cadence_id = state["cadence_id"]
    company = state["company"]

    # Extract domain from company (simple heuristic)
    domain = re.sub(r"[^a-z0-9]", "", company.lower().split()[0]) + ".com"

    await update_email_cadence(pool, cadence_id, status="discovering")
    logger.info("outreach_mailer.discovery_start", cadence_id=cadence_id, domain=domain,
                has_manager_name=bool(state.get("hiring_manager_name")))

    discovered_email = None
    email_confidence = None
    email_source = None

    # Pass 1 — Email Finder (if hiring manager name available)
    if state.get("hiring_manager_name"):
        name_parts = state["hiring_manager_name"].split(" ", 1)
        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ""
        result = await hunter_io.find_email(domain, first_name, last_name, settings.hunter_api_key)
        if result and result.get("score", 0) >= 70:
            discovered_email = result["email"]
            email_confidence = result["score"]
            email_source = "finder"

    # Pass 2 — Domain Search fallback
    if not discovered_email:
        results = await hunter_io.domain_search(domain, settings.hunter_api_key)
        if results:
            best = results[0]
            confidence = best.get("confidence", 0)
            email_val = best.get("value") or best.get("email")
            if confidence >= 70 and email_val:
                discovered_email = email_val
                email_confidence = confidence
                email_source = "domain_search"
            elif email_val:
                # Low confidence — surface for candidate override
                await update_email_cadence(
                    pool, cadence_id,
                    status="low_confidence",
                    hiring_manager_email=email_val,
                    email_confidence=confidence,
                )
                return {**state, "status": "low_confidence", "discovered_email": email_val,
                        "email_confidence": confidence, "email_source": "domain_search"}

    if not discovered_email:
        await update_email_cadence(pool, cadence_id, status="email_not_found")
        return {**state, "status": "email_not_found"}

    await update_email_cadence(
        pool, cadence_id,
        hiring_manager_email=discovered_email,
        email_confidence=email_confidence,
        email_source=email_source,
        status="generating",
    )

    logger.info("outreach_mailer.email_discovered",
                cadence_id=cadence_id, email=discovered_email, confidence=email_confidence, source=email_source)

    return {**state, "discovered_email": discovered_email,
            "email_confidence": email_confidence, "email_source": email_source, "status": "generating"}


async def generate_emails_node(state: OutreachMailerState, config) -> OutreachMailerState:
    """LiteLLM generation + self-review loop (max 3 attempts)."""
    pool = config["configurable"]["pool"]
    settings = config["configurable"]["settings"]
    cadence_id = state["cadence_id"]
    attempts = state.get("generation_attempts", 0)
    max_attempts = 3

    while attempts < max_attempts:
        attempts += 1
        try:
            draft = await litellm_generate(state, settings)
            d1_wc = _word_count(draft.day1_body)
            d3_wc = _word_count(draft.day3_body)
            d7_wc = _word_count(draft.day7_body)
            logger.info("outreach_mailer.draft_generated", cadence_id=cadence_id, attempt=attempts,
                        day1_words=d1_wc, day3_words=d3_wc, day7_words=d7_wc)
            review = await litellm_self_review(draft, settings)

            logger.info("outreach_mailer.self_review", cadence_id=cadence_id, attempt=attempts,
                        passes=review.passes, feedback=review.feedback[:100] if review.feedback else "")

            if review.passes:
                return {
                    **state,
                    "subject": draft.subject,
                    "day1_body": draft.day1_body,
                    "day3_body": draft.day3_body,
                    "day7_body": draft.day7_body,
                    "generation_attempts": attempts,
                }
        except Exception as exc:
            import traceback
            last_err = f"[{type(exc).__name__}] {str(exc)[:300]}"
            logger.warning("outreach_mailer.generation_error", attempt=attempts,
                           error_type=type(exc).__name__, error=str(exc)[:300],
                           traceback=traceback.format_exc()[-500:])
            # Write to DB immediately so it's visible even if overwritten
            try:
                await update_email_cadence(pool, cadence_id,
                                           error_message=f"Attempt {attempts}/{max_attempts}: {last_err}")
            except Exception:
                pass

    final_msg = locals().get("last_err", "Self-review failed") + f" (after {attempts} attempts)"
    await update_email_cadence(pool, cadence_id, status="failed", error_message=final_msg)
    return {**state, "status": "failed", "generation_attempts": attempts}


async def write_cadence_checkpoint_node(state: OutreachMailerState, config) -> OutreachMailerState:
    """Insert 3 draft rows and transition cadence to pending_approval."""
    pool = config["configurable"]["pool"]
    settings = config["configurable"]["settings"]
    cadence_id = state["cadence_id"]
    tracking_host = settings.tracking_host

    def _add_pixel(body_html: str, draft_id_placeholder: str) -> str:
        pixel = f'<img src="{tracking_host}/api/track/open/{draft_id_placeholder}" width="1" height="1" alt="">'
        return body_html + pixel

    day1_html = state["day1_body"] or ""
    day3_html = state["day3_body"] or ""
    day7_html = state["day7_body"] or ""

    drafts = [
        {
            "day_number": 1,
            "subject": state["subject"],
            "body_html": day1_html,
            "body_text": re.sub(r"<[^>]+>", "", day1_html),
            "original_body_html": day1_html,
        },
        {
            "day_number": 3,
            "subject": state["subject"],
            "body_html": day3_html,
            "body_text": re.sub(r"<[^>]+>", "", day3_html),
            "original_body_html": day3_html,
        },
        {
            "day_number": 7,
            "subject": state["subject"],
            "body_html": day7_html,
            "body_text": re.sub(r"<[^>]+>", "", day7_html),
            "original_body_html": day7_html,
        },
    ]

    await insert_email_drafts(pool, cadence_id, state["candidate_id"], drafts)
    await update_email_cadence(pool, cadence_id, status="pending_approval")

    logger.info("outreach_mailer.cadence_checkpoint_written", cadence_id=cadence_id)
    return {**state, "status": "pending_approval"}
