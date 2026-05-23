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
from agent.proxycurl import find_company_domain as _find_company_domain
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


async def litellm_generate(state: OutreachMailerState, settings,
                           candidate_profile: str = "") -> EmailDraftOutput:
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

    profile_line = candidate_profile if candidate_profile else state['archetype']

    prompt = (
        f"You are {candidate_name}, a job seeker writing cold outreach emails to a hiring manager.\n"
        f"Write in FIRST PERSON — use 'I', 'my', never 'the candidate'.\n\n"
        f"Candidate name : {candidate_name}\n"
        f"Role applying  : {state['job_title']} at {state['company']}\n"
        f"Your profile   :\n{profile_line}\n"
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
    draft = EmailDraftOutput(**data)

    # Append a fixed job reference line to all three drafts so the hiring
    # manager can immediately cross-reference the specific opening.
    # Uses model_copy to skip word-count validators — reference is a fixed suffix.
    job_url = (state.get("job_url") or "").strip()
    if job_url:
        ref_line = (
            f"\n\nJob reference: {state['job_title']} at {state['company']}\n{job_url}"
        )
        draft = draft.model_copy(update={
            "day1_body": draft.day1_body + ref_line,
            "day3_body": draft.day3_body + ref_line,
            "day7_body": draft.day7_body + ref_line,
        })

    return draft


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


def _is_plausible_email(email: str) -> bool:
    """Reject emails that look like LinkedIn URL slugs or are otherwise malformed."""
    if not email or '@' not in email:
        return False
    local = email.split('@')[0].lower()
    if 'linkedin' in local:
        return False
    if len(local) > 40:
        return False
    if local.count('-') > 3:
        return False
    return True


async def discover_email_node(state: OutreachMailerState, config) -> OutreachMailerState:
    """Four-pass email discovery with mandatory verification gate.

    Every candidate email is verified against the live mail server before
    being accepted.  Only 'deliverable' results are used; 'risky' results
    are stored as low_confidence for user review.

    Pass 1 — Hunter.io Email Finder (person-level, highest precision)
    Pass 2 — Exa web search (conference pages, GitHub, company team pages)
    Pass 3 — Email pattern guessing + verification (infers company pattern
              from domain search, generates candidates, verifies each)
    Pass 4 — Hunter.io Domain Search fallback (generic; last resort)
    """
    from agent.proxycurl import search_person_email

    pool       = config["configurable"]["pool"]
    settings   = config["configurable"]["settings"]
    cadence_id = state["cadence_id"]
    company    = state["company"]
    job_id     = state["job_id"]

    exa_api_key = getattr(settings, 'exa_api_key', '')
    hunter_key  = settings.hunter_api_key

    real_domain = await _find_company_domain(company, exa_api_key)
    domain      = real_domain or _company_to_domain(company)

    # Resolve contact name from LinkedIn connector if not already in state
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
            logger.info("outreach_mailer.using_linkedin_contact",
                        job_id=job_id, contact_name=hiring_manager_name, contact_title=row[1])

    await update_email_cadence(pool, cadence_id, status="discovering")
    logger.info("outreach_mailer.discovery_start", cadence_id=cadence_id,
                domain=domain, has_manager_name=bool(hiring_manager_name))

    # Strip LinkedIn headline suffixes before splitting into first/last name.
    # Stored names often look like "Lee Edwards - Recruitment Manager at Capgemini - LinkedIn".
    # We only want "Lee Edwards" for email pattern generation and web searches.
    import re as _re
    clean_name  = _re.split(r'\s*[-|,/]\s*', hiring_manager_name.strip())[0].strip() if hiring_manager_name else ""
    name_parts  = clean_name.split(" ", 1) if clean_name else []
    first_name  = name_parts[0] if name_parts else ""
    last_name   = name_parts[1] if len(name_parts) > 1 else ""

    # ── Shared verification helper ────────────────────────────────────────────

    async def _verify(email: str, source: str, base_confidence: int) -> tuple[str | None, int, str]:
        """Plausibility check then live verification. Returns (email, conf, src) or (None,0,'')."""
        if not _is_plausible_email(email):
            logger.debug("outreach_mailer.email_implausible", email=email, source=source)
            return None, 0, ""
        status = await hunter_io.verify_email(email, hunter_key)
        logger.info("outreach_mailer.email_verification", email=email,
                    status=status, source=source)
        if status == "deliverable":
            return email, max(base_confidence, 90), source
        if status == "risky":
            return email, min(base_confidence, 65), source   # cap risky at 65
        if status == "accept_all":
            # Catch-all domain: server accepts all mail; can't verify individual
            # address exists. Treat as a low-confidence suggestion (cap at 55)
            # so the user is shown the best candidate rather than a blank input.
            return email, min(base_confidence, 55), source
        return None, 0, ""   # undeliverable / unknown

    # Track a risky result in case nothing deliverable is found
    risky_email: str | None = None
    risky_conf:  int        = 0
    risky_src:   str        = ""

    async def _try(email: str, source: str, base_confidence: int) -> tuple[str | None, int, str]:
        nonlocal risky_email, risky_conf, risky_src
        e, c, s = await _verify(email, source, base_confidence)
        if e and c >= 90:
            return e, c, s
        if e and c > 0 and not risky_email:   # first risky result wins
            risky_email, risky_conf, risky_src = e, c, s
        return None, 0, ""

    # ── Pass 1: Hunter.io Email Finder ────────────────────────────────────────
    if first_name:
        result = await hunter_io.find_email(domain, first_name, last_name, hunter_key)
        if result and result.get("email"):
            e, c, s = await _try(result["email"], "finder", result.get("score", 70))
            if e:
                logger.info("outreach_mailer.email_found", pass_=1, email=e, confidence=c)
                await _finalise(pool, cadence_id, state, e, c, s, hiring_manager_name)
                return _success_state(state, e, c, s, hiring_manager_name)

    # ── Pass 2: Exa web search ────────────────────────────────────────────────
    if clean_name:
        web_email = await search_person_email(clean_name, company, exa_api_key)
        if web_email:
            e, c, s = await _try(web_email, "web_search", 80)
            if e:
                logger.info("outreach_mailer.email_found", pass_=2, email=e, confidence=c)
                await _finalise(pool, cadence_id, state, e, c, s, hiring_manager_name)
                return _success_state(state, e, c, s, hiring_manager_name)

    # ── Pass 3: Pattern guessing + verification ───────────────────────────────
    if first_name:
        pattern    = await hunter_io.infer_domain_pattern(domain, hunter_key)
        candidates = hunter_io.generate_email_candidates(first_name, last_name, domain, pattern)
        logger.info("outreach_mailer.pattern_candidates", domain=domain,
                    pattern=pattern, count=len(candidates))
        for candidate in candidates[:5]:           # verify up to 5 patterns
            e, c, s = await _try(candidate, "pattern_guess", 75)
            if e:
                logger.info("outreach_mailer.email_found", pass_=3, email=e, confidence=c)
                await _finalise(pool, cadence_id, state, e, c, s, hiring_manager_name)
                return _success_state(state, e, c, s, hiring_manager_name)

    # ── Pass 4: Hunter.io Domain Search fallback ──────────────────────────────
    domain_results = await hunter_io.domain_search(domain, hunter_key)
    for entry in domain_results[:3]:
        candidate = entry.get("value") or entry.get("email") or ""
        if not candidate:
            continue
        e, c, s = await _try(candidate, "domain_search", entry.get("confidence", 60))
        if e:
            logger.info("outreach_mailer.email_found", pass_=4, email=e, confidence=c)
            await _finalise(pool, cadence_id, state, e, c, s, hiring_manager_name)
            return _success_state(state, e, c, s, hiring_manager_name)

    # ── Risky fallback — present to user for confirmation ────────────────────
    if risky_email:
        logger.info("outreach_mailer.email_risky_fallback",
                    email=risky_email, confidence=risky_conf, source=risky_src)
        await update_email_cadence(pool, cadence_id, status="low_confidence",
                                   hiring_manager_email=risky_email,
                                   email_confidence=risky_conf)
        return {**state, "status": "low_confidence",
                "discovered_email": risky_email,
                "email_confidence": risky_conf,
                "email_source":     risky_src}

    # ── Nothing found ─────────────────────────────────────────────────────────
    logger.info("outreach_mailer.email_not_found", domain=domain)
    await update_email_cadence(pool, cadence_id, status="email_not_found")
    return {**state, "status": "email_not_found"}


async def _finalise(pool, cadence_id, state, email, confidence, source, name):
    await update_email_cadence(pool, cadence_id,
                               hiring_manager_email=email,
                               email_confidence=confidence,
                               email_source=source,
                               status="generating")
    logger.info("outreach_mailer.email_discovered",
                cadence_id=cadence_id, email=email,
                confidence=confidence, source=source)


def _success_state(state, email, confidence, source, name):
    return {
        **state,
        "hiring_manager_name": name or state.get("hiring_manager_name"),
        "discovered_email":    email,
        "email_confidence":    confidence,
        "email_source":        source,
        "status":              "generating",
    }


async def generate_emails_node(state: OutreachMailerState, config) -> OutreachMailerState:
    """LiteLLM generation + self-review loop (max 3 attempts)."""
    import json as _json
    pool = config["configurable"]["pool"]
    settings = config["configurable"]["settings"]
    cadence_id = state["cadence_id"]
    attempts = state.get("generation_attempts", 0)
    max_attempts = 3

    # Load candidate's parsed profile so emails reference real facts —
    # years of experience, actual roles, real skills — not guessed from archetype.
    candidate_profile = ""
    try:
        async with pool.execute(
            "SELECT parsed_profile FROM candidates WHERE id = ?",
            (state["candidate_id"],)
        ) as _cur:
            _row = await _cur.fetchone()
        if _row and _row[0]:
            _p = _json.loads(_row[0]) if isinstance(_row[0], str) else _row[0]
            _parts = []
            if _p.get("summary"):
                _parts.append(_p["summary"][:300])
            _roles = _p.get("roles", [])
            if _roles:
                _parts.append("Recent roles: " + " | ".join(
                    f"{r.get('title','')} at {r.get('company','')} ({r.get('dates','')})"
                    for r in _roles[:4]
                ))
            _skills = _p.get("skills", [])[:10]
            if _skills:
                _parts.append("Key skills: " + ", ".join(_skills))
            candidate_profile = "\n".join(_parts)
    except Exception:
        pass  # fall back to archetype label

    while attempts < max_attempts:
        attempts += 1
        try:
            draft = await litellm_generate(state, settings, candidate_profile=candidate_profile)
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
    # Drafts are always ready for candidate review regardless of email discovery outcome.
    # hiringManagerEmail being null in the DB is the signal that email entry is still needed;
    # status must be pending_approval so the UI surfaces the drafts.
    await update_email_cadence(pool, cadence_id, status="pending_approval")

    logger.info("outreach_mailer.cadence_checkpoint_written", cadence_id=cadence_id)
    return {**state, "status": "pending_approval"}
