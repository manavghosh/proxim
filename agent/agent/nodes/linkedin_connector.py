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

# ── State ────────────────────────────────────────────────────────────────────

class LinkedInConnectorState(TypedDict):
    # Input
    job_id:               str
    candidate_id:         str
    candidate_name:       str
    company:              str
    job_title:            str
    archetype:            str
    archetype_confidence: float
    # Discovery
    contact:          Optional[dict]
    enrichment:       Optional[dict]
    person_research:  str
    company_research: str
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


# ── LLM-driven role determination ────────────────────────────────────────────

async def determine_target_roles(job_title: str, company: str, archetype: str) -> list[str]:
    """Use the LLM to determine 3-5 ideal contact roles for this specific job.

    Replaces the static DISCOVERY_ROLES list — the LLM adapts to company
    type, job seniority, and archetype so the most relevant contacts are
    tried first.  Falls back to a sensible default list on any failure.
    """
    prompt = (
        f"A candidate is applying for: '{job_title}' at '{company}'.\n"
        f"Candidate archetype: {archetype}.\n\n"
        f"Who are the ideal LinkedIn contacts to approach at this company?\n"
        f"Consider the company type — large enterprise vs startup will differ.\n"
        f"For AI/tech roles target AI/engineering leadership first.\n"
        f"Always include HR/Talent Acquisition as a fallback.\n"
        f"Give 3-5 specific job titles, ordered from most valuable (hiring manager) "
        f"to least (recruiter).\n"
        f'Return JSON: {{"roles": ["Role 1", "Role 2", "Role 3"]}}'
    )
    try:
        resp = await litellm.acompletion(
            model=_llm_model(),
            api_key=_llm_api_key(),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=200,
        )
        raw   = resp.choices[0].message.content or "{}"
        data  = json.loads(raw)
        roles = [str(r) for r in data.get("roles", []) if r][:5]
        if roles:
            logger.info("linkedin.roles_determined", roles=roles, company=company)
            return roles
    except Exception as exc:
        logger.warning("linkedin.role_determination_failed", error=str(exc)[:200])

    return [
        "Chief AI Officer",
        "Chief Technology Officer",
        "Head of Artificial Intelligence",
        "Vice President of Engineering",
        "Talent Acquisition Manager",
    ]


# ── Node: discover_contact ────────────────────────────────────────────────────

async def discover_contact_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Search for a hiring manager using LLM-determined roles (adaptive per job)."""
    pool    = _pool(config)
    api_key = _px_key(config)
    company = state["company"]

    await update_outreach_target(pool, state["outreach_target_id"], status="discovering")

    roles = await determine_target_roles(
        job_title=state["job_title"],
        company=company,
        archetype=state["archetype"],
    )

    for role in roles:
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

    # Extract the person's REAL current title from the enrichment headline.
    # search_employees stores the search-role as title; we override it here
    # with the actual LinkedIn designation so notes reference the correct role.
    real_title = ""
    if enrichment:
        headline = enrichment.get("headline") or ""
        # Headline format: "Head of AI at Company" or "VP Engineering | LinkedIn"
        real_title = headline.split("|")[0].split(" at ")[0].strip()
    if not real_title:
        # Fall back to the first experience line that looks like a title
        exps = (enrichment or {}).get("experiences", [])
        if exps:
            real_title = exps[0].get("title", "").split(" at ")[0].strip()
    if not real_title:
        real_title = contact.get("title", "")

    await update_outreach_target(
        pool,
        state["outreach_target_id"],
        status="generating",
        title=real_title,
        enrichment_json=enrichment or {},
    )
    # Propagate real title into contact so generate_notes_node sees it
    updated_contact = {**contact, "title": real_title}
    return {"enrichment": enrichment, "status": "generating", "contact": updated_contact}


# ── Node: research_contact ────────────────────────────────────────────────────

async def research_contact_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Run real-time Exa research on the contact and their company.

    Fetches:
    - Person context: recent professional activity, talks, articles
    - Company context: recent AI announcements, news, strategy

    Results are stored in state and used by generate_notes_node to
    produce notes that reference real, timely information rather than
    generic phrases.
    """
    api_key = _px_key(config)
    contact = state.get("contact") or {}
    name    = contact.get("name", "")
    company = state["company"]

    person_research  = await proxycurl.research_person(name, company, api_key)
    company_research = await proxycurl.research_company(company, api_key)

    logger.info(
        "linkedin.research_complete",
        contact=name,
        company=company,
        has_person=bool(person_research),
        has_company=bool(company_research),
    )
    return {
        "person_research":  person_research,
        "company_research": company_research,
    }


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

    # Real current title — enrich_profile_node already updated contact["title"]
    # with the Exa headline; fall back to first experience line if blank.
    _TITLE_EXPANSIONS = {"CAIO": "Chief AI Officer"}
    raw_title = contact.get("title") or ""
    if not raw_title and experiences:
        raw_title = experiences[0].get("title", "").split(" at ")[0].strip()
    contact_title = _TITLE_EXPANSIONS.get(raw_title.strip().upper(), raw_title) or "leader"

    # Personalisation hook from experience or education
    hook = ""
    if experiences:
        exp_title = experiences[0].get("title", "")
        hook = f"their experience: {exp_title[:80]}" if exp_title else ""
    if not hook and education:
        school = (education[0].get("school") or {}).get("name", "")
        hook = f"their alma mater: {school}" if school else ""

    # Get candidate's first name for the closure
    candidate_name = state.get("candidate_name", "")
    first_name = contact.get("name", "").split()[0] or "there"

    prompt = (
        f"Contact: {contact.get('name', 'the contact')}, actual role: '{contact_title}' "
        f"at {state['company']}.\n"
        f"Personalisation hook: {hook or 'their work at ' + state['company']}.\n"
        f"My archetype: {state['archetype']}.\n\n"
        f"Generate two LinkedIn connection note variants (note_a, note_b).\n"
        f"STRICT FORMAT for each note (use literal \\n for newlines in JSON):\n"
        f"  Hi {first_name},\\n\\n[1-2 sentences referencing their actual role "
        f"'{contact_title}' and the personalisation hook — no job mention]"
        f"\\n\\nThanks,\\n{candidate_name or 'Manav Ghosh'}\n\n"
        f"RULES:\n"
        f"- Max 300 characters total (including newlines)\n"
        f"- Use their ACTUAL role '{contact_title}' — never invent a title\n"
        f"- note_a and note_b must be distinct in wording\n"
        f"- Never mention the job posting\n"
        f'Return JSON: {{"note_a": "...", "note_b": "..."}}'
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
