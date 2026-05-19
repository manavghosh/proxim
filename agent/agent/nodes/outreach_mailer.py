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
    job_id:  str
    job_url: str   # LinkedIn JD URL — used for logging/future targeting
    candidate_id: str
    candidate_name: str
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

    candidate_name = state.get("candidate_name") or "the candidate"
    hm_name        = state.get("hiring_manager_name") or ""

    # Build greeting based on whether we know the hiring manager's name
    if hm_name:
        hm_first = hm_name.split()[0]
        recipient_line   = f"Recipient: {hm_name}"
        greeting_instruction = (
            f"Open with 'Hi {hm_first},' or 'Dear {hm_first},' on its own line."
        )
    else:
        recipient_line   = "Recipient: Hiring Manager (name not known)"
        greeting_instruction = (
            "Open with 'Dear Hiring Manager,' or 'Hi there,' on its own line. "
            "NEVER write 'Dear the Hiring Manager' — it is grammatically incorrect."
        )

    prompt = (
        f"You are {candidate_name}, a job seeker writing cold outreach emails to a hiring manager.\n"
        f"Write in FIRST PERSON — use 'I', 'my', never 'the candidate'.\n\n"
        f"Candidate name : {candidate_name}\n"
        f"Role applying  : {state['job_title']} at {state['company']}\n"
        f"Your profile   : {state['archetype']}\n"
        f"{recipient_line}\n\n"
        "FORMATTING RULES (strictly follow):\n"
        "1. Separate every paragraph with a blank line (\\n\\n).\n"
        "2. The greeting must be on its own line, followed by a blank line.\n"
        "3. The sign-off must be on its own line after a blank line.\n"
        "4. Never write walls of text — each email must have at least 2 paragraphs.\n\n"
        "Write 3 emails:\n\n"
        f"day1_body — max 150 words:\n"
        f"  {greeting_instruction}\n"
        f"  Paragraph 1: Introduce yourself as {candidate_name} and why you're reaching out.\n"
        f"  Paragraph 2: One specific reason you're excited about {state['company']}.\n"
        f"  Closing paragraph: 'I have attached my resume for your reference. I would be grateful "
        f"if you could review it and reach out should there be any opening that aligns with my "
        f"skill set.'\n"
        f"  Sign-off: blank line, then 'Thanks & regards,' on one line, '{candidate_name}' on the next.\n\n"
        "day3_body — max 100 words:\n"
        f"  Paragraph 1: One concrete proof point or insight from YOUR experience.\n"
        f"  Closing sentence: Kindly request them to review the attached resume from the previous "
        f"email and connect if any suitable opening comes up.\n"
        f"  Sign-off: blank line, then 'Best,' on one line, '{candidate_name}' on the next.\n"
        "  Do NOT use: 'following up', 'checking in', 'just following', 'just checking'.\n\n"
        "day7_body — max 80 words:\n"
        f"  Paragraph 1: Gentle, low-pressure close. No urgency or pressure phrases.\n"
        f"  Closing sentence: Hope they have had a chance to review the resume and would love to "
        f"hear from them if there is a potential fit.\n"
        f"  Sign-off: blank line, then 'Thanks & regards,' on one line, '{candidate_name}' on the next.\n\n"
        f"subject — one concise line referencing the role and {candidate_name}.\n\n"
        'Return ONLY valid JSON: {"subject": "...", "day1_body": "...", "day3_body": "...", "day7_body": "..."}\n'
        "All newlines inside JSON strings must be escaped as \\n."
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
        "You are reviewing cold outreach emails written by a job seeker directly to a hiring manager.\n"
        "CRITICAL CHECK: Are the emails written in first person (I, my, I've) from the candidate? "
        "Reject any email that uses third-person language like 'the candidate', 'this individual', 'they'.\n"
        "Also check: personalisation, tone, value-proposition clarity, absence of spam signals.\n\n"
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

# ── Domain extraction ─────────────────────────────────────────────────────────

# Generic words that don't form the email domain of a company
_DOMAIN_STOPWORDS = frozenset([
    "technologies", "technology", "tech", "software", "systems", "solutions",
    "services", "service", "consulting", "consultancy", "group", "global",
    "india", "pvt", "private", "limited", "ltd", "inc", "corp", "corporation",
    "bpm", "labs", "lab", "digital", "ai", "data", "analytics", "cloud",
    "innovations", "innovation", "enterprises", "enterprise", "international",
    "and", "the", "of", "for", "co", "llc", "plc",
])


def _company_to_domain(company: str) -> str:
    """Extract the most likely email domain from a company name.

    Strips generic corporate suffixes so:
      'Aurigo Software Technologies' → 'aurigo.com'
      'Automation Anywhere'          → 'automationanywhere.com'
      'Tata Consultancy Services'    → 'tataconsultancy.com'
    """
    normalized = re.sub(r"[^a-z0-9\s]", "", company.lower()).split()
    meaningful  = [w for w in normalized if w not in _DOMAIN_STOPWORDS and len(w) > 1]
    if not meaningful:
        meaningful = normalized[:1]
    if len(meaningful) == 1:
        return f"{meaningful[0]}.com"
    return f"{''.join(meaningful[:2])}.com"


async def discover_email_node(state: OutreachMailerState, config) -> OutreachMailerState:
    """Hunter.io email discovery — uses LinkedIn contact name when available.

    Pass 1 (targeted): if the LinkedIn connector already discovered a contact
    for this job, uses their name + company domain in Hunter.io Email Finder
    for a precise, person-level lookup.

    Pass 2 (fallback): Hunter.io Domain Search — returns the highest-confidence
    personal email at the company domain.
    """
    pool     = config["configurable"]["pool"]
    settings = config["configurable"]["settings"]
    cadence_id = state["cadence_id"]
    company    = state["company"]
    job_id     = state["job_id"]

    domain = _company_to_domain(company)

    # ── Look up LinkedIn-discovered contact for Pass 1 ────────────────────────
    hiring_manager_name = state.get("hiring_manager_name") or ""
    if not hiring_manager_name and job_id:
        async with pool.execute(
            "SELECT name, title FROM outreach_targets "
            "WHERE job_id = ? AND name IS NOT NULL AND name != '' "
            "ORDER BY created_at DESC LIMIT 1",
            (job_id,)
        ) as cur:
            row = await cur.fetchone()
        if row and row[0]:
            hiring_manager_name = row[0]
            logger.info(
                "outreach_mailer.using_linkedin_contact",
                job_id=job_id,
                contact_name=hiring_manager_name,
                contact_title=row[1],
            )

    await update_email_cadence(pool, cadence_id, status="discovering")
    logger.info(
        "outreach_mailer.discovery_start",
        cadence_id=cadence_id,
        domain=domain,
        has_manager_name=bool(hiring_manager_name),
    )

    discovered_email = None
    email_confidence = None
    email_source     = None

    # Pass 1 — Email Finder (person-level, high precision)
    if hiring_manager_name:
        name_parts = hiring_manager_name.split(" ", 1)
        first_name = name_parts[0]
        last_name  = name_parts[1] if len(name_parts) > 1 else ""
        result = await hunter_io.find_email(domain, first_name, last_name, settings.hunter_api_key)
        if result and result.get("score", 0) >= 70:
            discovered_email = result["email"]
            email_confidence = result["score"]
            email_source     = "finder"
            logger.info(
                "outreach_mailer.email_found_by_name",
                contact=hiring_manager_name,
                email=discovered_email,
                confidence=email_confidence,
            )

    # Pass 2 — Domain Search fallback (generic, lower precision)
    if not discovered_email:
        results = await hunter_io.domain_search(domain, settings.hunter_api_key)
        if results:
            best       = results[0]
            confidence = best.get("confidence", 0)
            email_val  = best.get("value") or best.get("email")
            if confidence >= 70 and email_val:
                discovered_email = email_val
                email_confidence = confidence
                email_source     = "domain_search"
            elif email_val:
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
    logger.info(
        "outreach_mailer.email_discovered",
        cadence_id=cadence_id,
        email=discovered_email,
        confidence=email_confidence,
        source=email_source,
    )

    return {
        **state,
        "hiring_manager_name": hiring_manager_name or state.get("hiring_manager_name"),
        "discovered_email":    discovered_email,
        "email_confidence":    email_confidence,
        "email_source":        email_source,
        "status":              "generating",
    }


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

    def _to_html(text: str) -> str:
        """Convert plain-text email to HTML: double newlines → paragraph break."""
        import html as _html
        escaped = _html.escape(text)
        return escaped.replace('\n\n', '<br><br>').replace('\n', '<br>')

    day1_html = _to_html(state["day1_body"] or "")
    day3_html = _to_html(state["day3_body"] or "")
    day7_html = _to_html(state["day7_body"] or "")

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
