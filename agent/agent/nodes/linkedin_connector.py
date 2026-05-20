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
    job_url:              str   # LinkedIn JD URL — used to extract actual hiring team
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

async def determine_target_roles(job_title: str, company: str) -> list[str]:
    """Use the LLM to determine 3-5 ideal contact roles for this specific job.

    The LLM reasons from the job title and company context — NOT from the
    candidate's archetype — so the output adapts to any function:
      'VP of Sales' job   → Sales Director, Head of Sales, VP Sales…
      'AI Architect' job  → Head of AI, CTO, VP Engineering…
      'CFO' job           → CEO, Finance Director, Board Member…

    Falls back to a generic 3-role list that works for any job type.
    """
    prompt = (
        f"A candidate is applying for the role: '{job_title}' at '{company}'.\n\n"
        f"Who at this company would make the hiring decision for this role, "
        f"or be the most valuable LinkedIn contact to approach?\n\n"
        f"Reason from the job title and function — not from any specific industry bias.\n"
        f"Consider: who manages people in this function? Who owns budget for this role? "
        f"Who would be the direct manager or skip-level manager?\n\n"
        f"Give 3-5 specific job titles ordered from most valuable (direct hiring manager) "
        f"to least (HR/recruiter as last resort). "
        f"Be specific to the job function — a Sales role needs Sales leadership, "
        f"a Finance role needs Finance leadership, a Tech role needs Tech leadership.\n\n"
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
            logger.info("linkedin.roles_determined", job_title=job_title,
                        roles=roles, company=company)
            return roles
    except Exception as exc:
        logger.warning("linkedin.role_determination_failed", error=str(exc)[:200])

    # Generic fallback — works for any job function; does NOT assume AI/tech context.
    # Recruiter and Talent Acquisition are universal last resorts.
    return ["Hiring Manager", "Talent Acquisition Manager", "Recruiter"]


# ── Node: extract_hiring_team ─────────────────────────────────────────────────

async def extract_hiring_team_node(
    state: LinkedInConnectorState,
    config: RunnableConfig,
) -> dict:
    """Extract the actual job poster from the LinkedIn JD URL (highest priority).

    Uses Exa content fetch to parse the 'Meet the hiring team' section.
    On success: writes the person to outreach_targets with seniority='JOB_POSTER'
                and returns contact + status='enriching', skipping discover_contact.
    On failure: returns {} so the pipeline falls through to discover_contact_node.
    """
    api_key = _px_key(config)
    pool    = _pool(config)
    job_url = state.get("job_url", "")

    if not job_url:
        logger.info("linkedin.hiring_team_skip", reason="no_job_url")
        return {}

    person = await proxycurl.extract_hiring_team_from_jd(job_url, api_key)
    if not person or not person.get("name"):
        logger.info(
            "linkedin.hiring_team_not_found",
            company=state["company"],
            job_url=job_url,
        )
        return {}

    # If Exa extracted a name but no LinkedIn URL, search for their profile by name
    linkedin_url = person.get("linkedin_url", "")
    if not linkedin_url:
        logger.info(
            "linkedin.hiring_team_searching_profile",
            name=person["name"],
            company=state["company"],
        )
        found = await proxycurl.search_employees(
            company_name=state["company"],
            role=person["name"],          # search by person's name, not a role title
            api_key=api_key,
        )
        if found and found.get("profile_url"):
            linkedin_url = found["profile_url"]
            logger.info("linkedin.hiring_team_profile_found",
                        name=person["name"], url=linkedin_url)

    contact = {
        "name":        person["name"],
        "title":       person["title"],
        "profile_url": linkedin_url,
    }
    await update_outreach_target(
        pool,
        state["outreach_target_id"],
        status="enriching",
        name=contact["name"],
        linkedin_url=contact["profile_url"],
        title=contact["title"],
        seniority="JOB_POSTER",
    )
    logger.info(
        "linkedin.hiring_team_found",
        company=state["company"],
        name=person["name"],
        title=person["title"],
    )
    return {"contact": contact, "status": "enriching"}


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
    # Pass job_title so company research focuses on the relevant function
    # (e.g. "sales growth" for a Sales role, not generic AI/tech news)
    company_research = await proxycurl.research_company(
        company, api_key, job_context=state.get("job_title", "")
    )

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

MAX_NOTE_RETRIES = 3


async def generate_notes_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Generate A/B connection notes using real-time research for genuine personalisation.

    Uses three tiers of personalisation context (highest to lowest priority):
    1. Real-time Exa research (person_research, company_research from research_contact_node)
    2. Proxycurl enrichment signals (experience, education)
    3. Basic contact info (name, title, company)

    The system prompt and note structure are constructed dynamically per contact
    — no static templates.
    """
    pool             = _pool(config)
    enrichment       = state.get("enrichment") or {}
    contact          = state.get("contact") or {}
    person_research  = state.get("person_research", "")
    company_research = state.get("company_research", "")

    contact_name   = contact.get("name", "")
    candidate_name = state.get("candidate_name", "")

    # Real title from enrich_profile_node; fall back to first experience line
    raw_title = contact.get("title", "")
    if not raw_title:
        exps = enrichment.get("experiences", [])
        if exps:
            raw_title = exps[0].get("title", "").split(" at ")[0].strip()
    _EXPANSIONS = {"CAIO": "Chief AI Officer"}
    contact_title = _EXPANSIONS.get(raw_title.strip().upper(), raw_title) or "professional"

    # Build research context block — real-time Exa data takes priority
    context_parts: list[str] = []
    if person_research:
        context_parts.append(f"Recent context about {contact_name}:\n{person_research}")
    if company_research:
        context_parts.append(f"Recent news about {state['company']}:\n{company_research}")
    # Fallback to enrichment signals if Exa research is empty
    if not context_parts:
        exps = enrichment.get("experiences", [])
        edu  = enrichment.get("education", [])
        if exps and exps[0].get("title"):
            context_parts.append(f"Known about them: {exps[0]['title']}")
        elif edu:
            school = (edu[0].get("school") or {}).get("name", "")
            if school:
                context_parts.append(f"Known: studied at {school}")
    research_block = "\n\n".join(context_parts) if context_parts else "No additional context available."

    # Dynamic system prompt — structure enforced, angle decided by context
    system = (
        "You write hyper-personalised LinkedIn connection notes (max 300 chars each).\n"
        "Each note MUST follow this exact structure (use \\n for newlines in JSON):\n"
        "  Line 1: 'Hi [FirstName],'\n"
        "  Line 2: (blank)\n"
        "  Lines 3-4: 1-2 sentences using REAL context from the research below\n"
        "  Line 5: (blank)\n"
        "  Line 6: 'Thanks,'\n"
        "  Line 7: candidate's name\n\n"
        "Rules: never mention a job posting; use actual role title; "
        "note_a and note_b must differ in angle not just wording; max 300 chars total."
    )

    prompt = (
        f"Contact: {contact_name}, {contact_title} at {state['company']}\n"
        f"Candidate: {candidate_name} — {state['archetype']}\n\n"
        f"{research_block}\n\n"
        f"note_a angle: company innovation / recent news\n"
        f"note_b angle: the person's own expertise or career\n\n"
        f'Return JSON: {{"note_a": "...", "note_b": "..."}}'
    )

    await update_outreach_target(pool, state["outreach_target_id"], status="generating")

    last_error: str = ""
    for attempt in range(1, MAX_NOTE_RETRIES + 1):
        logger.info(
            "linkedin.generate_notes",
            attempt=attempt,
            candidate_id=state["candidate_id"],
            has_research=bool(person_research or company_research),
        )
        response = litellm.completion(
            model=_llm_model(),
            api_key=_llm_api_key(),
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        try:
            parsed   = json.loads(raw)
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
