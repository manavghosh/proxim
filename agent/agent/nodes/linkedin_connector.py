"""LinkedIn Connector LangGraph nodes (F5).

State machine: pending → discovering → enriching → generating → notes_ready
Terminal exits: skipped_dnc | no_contact_found | failed
"""
from __future__ import annotations

import json
import structlog
from typing import TypedDict, Optional

import litellm
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, field_validator

from agent import proxycurl
from agent.config import settings as _settings
from agent.db_sqlite import (
    get_candidate_preferences,
    update_outreach_target,
)


def _llm_model() -> str:
    return f"{_settings.llm_provider}/{_settings.llm_model}"


def _llm_api_key() -> str:
    if _settings.llm_provider == "gemini":
        return _settings.gemini_api_key
    return _settings.anthropic_api_key

logger = structlog.get_logger(__name__)

# ── Role priority order (FR-001/FR-002) ──────────────────────────────────────

DISCOVERY_ROLES = [
    "Chief AI Officer",
    "CTO",
    "VP AI",
    "Head of AI",
    "VP Engineering",
    "Engineering Director",
    "HR Director",
    "Talent Acquisition",
    "Recruiter",
]

# ── State ────────────────────────────────────────────────────────────────────

class LinkedInConnectorState(TypedDict):
    # Input
    job_id:               str
    candidate_id:         str
    company:              str
    job_title:            str
    archetype:            str
    archetype_confidence: float
    # Discovery
    contact:    Optional[dict]
    enrichment: Optional[dict]
    # Generation
    note_a:              Optional[str]
    note_b:              Optional[str]
    generation_attempts: int
    # Output
    outreach_target_id: Optional[str]
    status:             str
    error:              Optional[str]

# ── Note validation ───────────────────────────────────────────────────────────

_FORBIDDEN = [
    "i saw your job posting",
    "i noticed your job posting",
    "i came across your job posting",
]


class NoteVariants(BaseModel):
    note_a: str
    note_b: str

    @field_validator("note_a", "note_b")
    @classmethod
    def validate_note(cls, v: str) -> str:
        if len(v) > 300:
            raise ValueError(f"Note exceeds 300 chars ({len(v)})")
        for phrase in _FORBIDDEN:
            if phrase in v.lower():
                raise ValueError(f"Forbidden phrase detected: '{phrase}'")
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pool(config: RunnableConfig):
    return config["configurable"]["pool"]


def _px_key(config: RunnableConfig) -> str:
    return config["configurable"].get("proxycurl_api_key", "")


# ── Node: check_dnc ───────────────────────────────────────────────────────────

async def check_dnc_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Skip the pipeline if the company is on the DNC list (FR-003)."""
    pool = _pool(config)
    prefs   = await get_candidate_preferences(pool, state["candidate_id"])
    dnc     = [c.lower() for c in prefs.get("do_not_contact_companies", [])]
    company = state["company"].lower()

    if company in dnc:
        logger.info(
            "linkedin.dnc_skip",
            company=state["company"],
            candidate_id=state["candidate_id"],
        )
        await update_outreach_target(
            pool, state["outreach_target_id"], status="skipped_dnc"
        )
        return {"status": "skipped_dnc"}

    return {"status": "discovering"}


# ── Node: discover_contact ────────────────────────────────────────────────────

async def discover_contact_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Search for a hiring manager via Proxycurl employee search (FR-001/FR-002)."""
    pool    = _pool(config)
    api_key = _px_key(config)
    company = state["company"]

    await update_outreach_target(pool, state["outreach_target_id"], status="discovering")

    for role in DISCOVERY_ROLES:
        logger.info("proxycurl.employee_search", company=company, role=role)
        contact = await proxycurl.search_employees(
            company_name=company, role=role, api_key=api_key
        )
        if contact:
            seniority = role.upper().replace(" ", "_")
            await update_outreach_target(
                pool,
                state["outreach_target_id"],
                status="enriching",
                name=contact.get("name"),
                linkedin_url=contact.get("profile_url"),
                title=contact.get("title"),
                seniority=seniority,
            )
            logger.info(
                "linkedin.contact_found",
                company=company,
                role=role,
                name=contact.get("name"),
            )
            return {"contact": contact, "status": "enriching"}

    logger.info("linkedin.no_contact_found", company=company)
    await update_outreach_target(
        pool, state["outreach_target_id"], status="no_contact_found"
    )
    return {"contact": None, "status": "no_contact_found"}


# ── Node: enrich_profile ──────────────────────────────────────────────────────

async def enrich_profile_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Enrich the discovered contact's profile via Proxycurl (FR-004)."""
    pool       = _pool(config)
    api_key    = _px_key(config)
    contact    = state["contact"] or {}
    profile_url = contact.get("profile_url") or contact.get("linkedin_url", "")

    enrichment = await proxycurl.enrich_profile(linkedin_url=profile_url, api_key=api_key)

    await update_outreach_target(
        pool,
        state["outreach_target_id"],
        status="generating",
        enrichment_json=enrichment or {},
    )
    return {"enrichment": enrichment, "status": "generating"}


# ── Node: generate_notes ──────────────────────────────────────────────────────

_NOTE_SYSTEM = (
    "You are a professional networking specialist. Generate two distinct, "
    "personalised LinkedIn connection notes. Each must be under 300 characters, "
    "use a personalisation hook from the contact's profile, and must NOT mention "
    "any job posting. Return JSON: {\"note_a\": \"...\", \"note_b\": \"...\"}."
)

MAX_NOTE_RETRIES = 3


async def generate_notes_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Generate two A/B connection note variants with LiteLLM (FR-005/FR-006/FR-007)."""
    pool       = _pool(config)
    enrichment = state.get("enrichment") or {}
    contact    = state.get("contact") or {}

    # Build personalisation context
    experiences = enrichment.get("experiences", [])
    education   = enrichment.get("education", [])
    tenure_hook = ""
    if experiences:
        exp = experiences[0]
        start = exp.get("starts_at") or {}
        year  = start.get("year", "")
        tenure_hook = f"role since {year}" if year else exp.get("title", "")

    edu_hook = ""
    if education:
        school = (education[0].get("school") or {}).get("name", "")
        edu_hook = f"alma mater: {school}" if school else ""

    prompt = (
        f"Contact: {contact.get('name', 'the contact')}, {contact.get('title', 'leader')} "
        f"at {state['company']}.\n"
        f"Personalisation hooks: {tenure_hook}. {edu_hook}.\n"
        f"My archetype: {state['archetype']}. Applied job: {state['job_title']}.\n"
        f"Generate two connection notes (note_a and note_b), each ≤300 characters, "
        f"each using at least one hook above. Never mention the job posting."
    )

    await update_outreach_target(pool, state["outreach_target_id"], status="generating")

    last_error: str = ""
    for attempt in range(1, MAX_NOTE_RETRIES + 1):
        logger.info(
            "linkedin.generate_notes",
            attempt=attempt,
            candidate_id=state["candidate_id"],
        )
        response = litellm.completion(
            model=_llm_model(),
            api_key=_llm_api_key(),
            messages=[
                {"role": "system", "content": _NOTE_SYSTEM},
                {"role": "user",   "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        try:
            parsed  = json.loads(raw)
            variants = NoteVariants(**parsed)
            await update_outreach_target(
                pool,
                state["outreach_target_id"],
                status="notes_ready",
                note_a=variants.note_a,
                note_b=variants.note_b,
            )
            return {
                "note_a":              variants.note_a,
                "note_b":              variants.note_b,
                "generation_attempts": attempt,
                "status":              "notes_ready",
            }
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "linkedin.note_validation_failed",
                attempt=attempt,
                error=last_error,
            )

    await update_outreach_target(
        pool,
        state["outreach_target_id"],
        status="failed",
        error_message=f"Note generation failed after {MAX_NOTE_RETRIES} attempts: {last_error}",
    )
    return {
        "generation_attempts": MAX_NOTE_RETRIES,
        "status":              "failed",
        "error":               last_error,
    }
