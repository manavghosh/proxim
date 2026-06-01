"""LinkedIn data client using Exa AI people search.

Proxycurl was shut down July 2026 (LinkedIn lawsuit). This module is a
drop-in replacement using Exa's people search API — same function signatures,
same return shapes, zero breaking changes to any node or daemon code.

Sign up for a free key (1,000 req/month) at https://exa.ai
Add to agent/.env:  EXA_API_KEY=your_key_here
"""
from __future__ import annotations

import asyncio
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


class ProxycurlRateLimitError(Exception):
    """Raised when the upstream API returns a rate-limit response."""


# Transient upstream failures worth retrying. Exa runs live web crawls per
# request, so under load a single call can exceed Cloudflare's gateway timeout
# (524) or hit a transient 5xx — almost always succeeds on a quick retry.
_TRANSIENT_STATUS = ("500", "502", "503", "504", "524")


def _exa_client(api_key: str):
    from exa_py import Exa  # pip install exa_py
    return Exa(api_key=api_key)


async def _exa_call(fn, *, attempts: int = 3, base_delay: float = 2.0):
    """Run a synchronous Exa SDK call with retry/backoff on transient 5xx errors.

    Rate limits (429) and non-transient errors are raised immediately so each
    caller keeps its existing handling. Transient gateway timeouts / 5xx are
    retried with linear backoff; the final failure is re-raised unchanged.
    """
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            msg = str(exc)
            # Never retry rate limits — let the caller raise ProxycurlRateLimitError.
            if "429" in msg or "rate" in msg.lower():
                raise
            # Only retry transient upstream gateway timeouts / 5xx.
            if not any(code in msg for code in _TRANSIENT_STATUS):
                raise
            last_exc = exc
            if attempt < attempts:
                delay = base_delay * attempt
                logger.warning("exa.transient_retry", attempt=attempt,
                               max_attempts=attempts, delay=delay, error=msg[:120])
                await asyncio.sleep(delay)
    # Exhausted retries on a transient error — re-raise so the caller logs it.
    raise last_exc  # type: ignore[misc]


async def search_employees(
    company_name: str,
    role: str,
    api_key: str,
) -> Optional[dict]:
    """Find the first employee matching `role` at `company_name`.

    Uses Exa people search with the query pattern: "{role} at {company_name}"
    Returns a dict with name, title, profile_url — or None if no match.
    Raises ProxycurlRateLimitError on HTTP 429.
    """
    if not api_key:
        logger.warning("exa.no_api_key", hint="Set EXA_API_KEY in agent/.env")
        return None

    query = f"{role} at {company_name}"
    try:
        exa     = _exa_client(api_key)
        results = await _exa_call(lambda: exa.search(
            query,
            category="people",
            num_results=1,
        ))

        if not results.results:
            logger.info("exa.no_match", company=company_name, role=role, query=query)
            return None

        hit = results.results[0]
        raw_url = hit.url or ""
        # Normalise to www.linkedin.com — bare linkedin.com redirects can cause 404s
        url = raw_url.replace("https://linkedin.com/", "https://www.linkedin.com/", 1)
        logger.info(
            "exa.employee_found",
            company=company_name,
            role=role,
            url=url,
            credits_consumed=1,
        )
        return {
            "name":        hit.title or "",
            "title":       role,
            "profile_url": url,
        }

    except Exception as exc:
        msg = str(exc)
        if "429" in msg or "rate" in msg.lower():
            logger.warning("exa.rate_limit", company=company_name, role=role)
            raise ProxycurlRateLimitError("Exa rate limit hit") from exc
        logger.error("exa.search_error", company=company_name, role=role, error=msg)
        return None


async def find_company_domain(company: str, api_key: str) -> Optional[str]:
    """Find a company's real email domain via global Exa web search.

    Searches for the company's official website and extracts the root domain,
    correctly handling all country TLDs: .com.au (Australia), .co.uk (UK),
    .in (India), .de (Germany), .sg (Singapore), etc.

    Falls back to None so callers can use _company_to_domain() as last resort.
    """
    if not api_key or not company:
        return None

    # Domains to skip — not the company's own site
    _SKIP = frozenset([
        "linkedin.com", "glassdoor.com", "indeed.com", "naukri.com",
        "wikipedia.org", "facebook.com", "twitter.com", "youtube.com",
        "ambitionbox.com", "crunchbase.com", "bloomberg.com", "reuters.com",
        "techcrunch.com", "iimjobs.com", "monster.com", "seek.com.au",
        "jobstreet.com", "timesjobs.com", "shine.com",
    ])
    # Country-code TLDs that form two-part suffixes (.com.au, .co.uk, .net.in)
    _CC_TLDS = frozenset([
        "au", "uk", "in", "nz", "za", "sg", "de", "fr", "jp", "cn",
        "ca", "br", "mx", "es", "it", "nl", "se", "no", "dk", "fi",
        "pl", "ru", "hk", "tw", "kr", "ae", "sa", "eg", "ng", "ke",
    ])

    query = f"{company} official website"
    try:
        exa     = _exa_client(api_key)
        results = await _exa_call(lambda: exa.search(query, num_results=5))
        for hit in results.results:
            url = hit.url or ""
            if not url:
                continue
            try:
                from urllib.parse import urlparse as _up
                netloc = _up(url).netloc.lower()
                if netloc.startswith("www."):
                    netloc = netloc[4:]
                if any(skip in netloc for skip in _SKIP):
                    continue
                parts = netloc.split(".")
                if len(parts) < 2:
                    continue
                # Country TLD → keep last 3 parts (e.g. commbank.com.au)
                # Standard TLD → keep last 2 parts (e.g. barclays.com)
                domain = (
                    ".".join(parts[-3:]) if parts[-1] in _CC_TLDS and len(parts) >= 3
                    else ".".join(parts[-2:])
                )
                logger.info("exa.company_domain_found",
                            company=company, domain=domain)
                return domain
            except Exception:
                continue
        logger.info("exa.company_domain_not_found", company=company)
        return None
    except Exception as exc:
        msg = str(exc)
        if "429" in msg or "rate" in msg.lower():
            raise ProxycurlRateLimitError("Exa rate limit hit") from exc
        logger.debug("exa.find_domain_error", company=company, error=msg[:100])
        return None


async def search_person_profile(
    name: str,
    company: str,
    api_key: str,
) -> Optional[str]:
    """Find a specific person's LinkedIn profile URL via global web search.

    Uses an unrestricted Exa search (no category filter) so results come
    from the entire web — news articles, company bios, conference pages, etc.
    Any result containing a linkedin.com/in/ URL is used.

    This is more reliable than category="people" when the person isn't
    prominently indexed in Exa's LinkedIn-specific people index.
    Returns the normalised profile URL or None.
    """
    if not api_key or not name:
        return None
    query = f"{name} {company} LinkedIn profile"
    try:
        exa = _exa_client(api_key)
        # Global search — no category restriction
        results = await _exa_call(lambda: exa.search(query, num_results=5))
        for hit in results.results:
            url = hit.url or ""
            if "linkedin.com/in/" in url:
                url = url.replace("https://linkedin.com/", "https://www.linkedin.com/", 1)
                logger.info("exa.person_profile_found", name=name, url=url)
                return url
        logger.info("exa.person_profile_not_found", name=name, company=company)
        return None
    except Exception as exc:
        msg = str(exc)
        if "429" in msg or "rate" in msg.lower():
            raise ProxycurlRateLimitError("Exa rate limit hit") from exc
        logger.debug("exa.search_person_error", name=name, error=msg[:100])
        return None


async def enrich_profile(
    linkedin_url: str,
    api_key: str,
) -> Optional[dict]:
    """Fetch enrichment data for a LinkedIn profile URL via Exa content fetch.

    Returns a ProxycurlPersonEnrichment-shaped dict or None.
    Raises ProxycurlRateLimitError on HTTP 429.
    """
    if not api_key or not linkedin_url:
        return None

    try:
        exa     = _exa_client(api_key)
        results = await _exa_call(lambda: exa.get_contents(
            [linkedin_url],
            text=True,
        ))

        if not results.results:
            logger.warning("exa.enrich_no_content", url=linkedin_url)
            return None

        content = results.results[0].text or ""
        name    = results.results[0].title or ""

        # Parse basic signals from the raw text content
        enrichment = _parse_profile_text(content, name)
        logger.info(
            "exa.profile_enriched",
            url=linkedin_url,
            full_name=enrichment.get("full_name"),
            credits_consumed=1,
        )
        return enrichment

    except Exception as exc:
        msg = str(exc)
        if "429" in msg or "rate" in msg.lower():
            logger.warning("exa.rate_limit", url=linkedin_url)
            raise ProxycurlRateLimitError("Exa rate limit hit") from exc
        logger.error("exa.enrich_error", url=linkedin_url, error=msg)
        return None


def _parse_profile_text(text: str, title: str) -> dict:
    """Extract structured signals from raw LinkedIn page text for note generation.

    Exa returns the page text; we pull out the most useful hooks for note gen:
    current role, company, and any education signals visible in the text.
    """
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    # Title line usually has "Name | Role at Company | LinkedIn"
    full_name = ""
    headline  = ""
    if title:
        parts     = [p.strip() for p in title.split("|")]
        full_name = parts[0] if parts else ""
        headline  = parts[1] if len(parts) > 1 else ""

    # Surface experience and education lines as simple entries
    # (exact parsing varies by profile; provide best-effort signals)
    experiences = []
    education   = []
    for line in lines[:40]:
        lower = line.lower()
        if any(w in lower for w in ["university", "iit", "iim", "college", "institute", "school of"]):
            education.append({
                "degree_name": None,
                "school":      {"name": line},
                "ends_at":     None,
            })
        elif len(line) > 10 and any(w in lower for w in ["at ", " · ", "director", "vp ", "head of", "chief", "manager"]):
            experiences.append({
                "title":     line,
                "company":   "",
                "starts_at": None,
                "ends_at":   None,
            })

    return {
        "full_name":   full_name,
        "headline":    headline,
        "summary":     None,
        "experiences": experiences[:5],
        "education":   education[:3],
    }


# ── LinkedIn JD hiring team extraction ───────────────────────────────────────

import re as _re

_HIRING_ANCHORS = _re.compile(
    r"(job poster|hiring manager|meet the hiring team|recruiter)",
    _re.IGNORECASE,
)
_LI_PROFILE_RE = _re.compile(r"https?://(?:www\.)?linkedin\.com/in/([\w%-]+)")

# Words that look like title-case names but are actually job-title components.
# Prevents "Senior Director" or "Head Engineering" being parsed as person names.
_JOB_TITLE_WORDS = frozenset([
    # Job-title components
    "senior", "junior", "chief", "head", "lead", "director", "manager",
    "engineer", "architect", "product", "software", "data", "analytics",
    "global", "regional", "national", "solutions", "services", "platform",
    "technical", "technology", "operations", "business", "strategy",
    # Page section headers that are NOT person names
    "job", "description", "about", "role", "position", "opportunity",
    "opening", "vacancy", "responsibilities", "requirements", "qualifications",
    "benefits", "skills", "experience", "overview", "summary", "details",
    "apply", "section", "information", "profile", "poster",
])


def _is_person_name(text: str) -> bool:
    """Return True if *text* looks like a person's full name.

    Criteria:
    - 2–4 whitespace-separated words (first + last [+ middle/suffix])
    - Each word starts with a Unicode uppercase letter (handles accented chars)
    - No word is a known job-title keyword (avoids "Senior Director" etc.)
    - Words contain only letters, apostrophes, or hyphens
    """
    import unicodedata as _uc
    words = text.split()
    if not (2 <= len(words) <= 4):
        return False
    lower_words = [w.lower().strip("'-") for w in words]
    if any(w in _JOB_TITLE_WORDS for w in lower_words):
        return False
    for word in words:
        bare = word.strip("'-")
        if not bare:
            return False
        # First char must be Unicode uppercase letter
        if _uc.category(bare[0]) != "Lu":
            return False
        # Remaining chars must be letters, apostrophes, or hyphens
        for ch in bare[1:]:
            cat = _uc.category(ch)
            if not (cat.startswith("L") or ch in "'-"):
                return False
    return True


def _parse_hiring_team(content: str) -> Optional[dict]:
    """Parse 'Meet the hiring team' section from Exa page text.

    Handles two common LinkedIn formats:
      1. Multi-line: 'Meet the hiring team\\nElizabeth Garcia Nichols\\nJob poster'
      2. Inline:     'Elizabeth Garcia Nichols · Job poster'
    Returns {"name", "title", "linkedin_url"} or None.
    """
    lines = [l.strip() for l in content.splitlines() if l.strip()]

    # Find the anchor line containing hiring-team keywords
    anchor_idx = None
    for i, line in enumerate(lines):
        if _HIRING_ANCHORS.search(line):
            anchor_idx = i
            break
    if anchor_idx is None:
        return None

    # Check if the anchor line itself is "Name · Job poster" (inline format)
    name  = ""
    title = "Job Poster"
    anchor_line = lines[anchor_idx]
    if " · " in anchor_line:
        candidate = _re.split(r"\s*·\s*", anchor_line)[0].strip()
        if _is_person_name(candidate):
            name = candidate

    # Scan ±4 lines around anchor for a standalone name line
    if not name:
        window = lines[max(0, anchor_idx - 4): min(len(lines), anchor_idx + 5)]
        for line in window:
            if _HIRING_ANCHORS.search(line):
                continue
            # "Name · Role" format on a nearby line
            if " · " in line:
                candidate = _re.split(r"\s*·\s*", line)[0].strip()
                if _is_person_name(candidate):
                    name = candidate
                    break
            # Standalone name line
            if _is_person_name(line):
                name = line
                break

    if not name:
        return None

    # Extract the first LinkedIn profile URL from full content
    linkedin_url = ""
    for m in _LI_PROFILE_RE.finditer(content):
        url = m.group(0)
        url = url.replace("https://linkedin.com/", "https://www.linkedin.com/", 1)
        linkedin_url = url
        break

    return {"name": name, "title": title, "linkedin_url": linkedin_url}


async def extract_hiring_team_from_jd(
    job_url: str,
    api_key: str,
) -> Optional[dict]:
    """Fetch a LinkedIn JD page via Exa and extract the 'Meet the hiring team' person.

    Returns {"name": str, "title": str, "linkedin_url": str} or None.
    Never raises — all errors are logged and swallowed.
    """
    if not api_key or not job_url:
        return None
    # Only attempt extraction for LinkedIn job pages — other sources (Naukri,
    # IIMJobs, careers pages) don't have a 'Meet the hiring team' section and
    # would waste an Exa credit for certain-empty results.
    if "linkedin.com" not in job_url:
        logger.debug("exa.jd_skip_non_linkedin", url=job_url)
        return None
    try:
        exa     = _exa_client(api_key)
        results = await _exa_call(lambda: exa.get_contents([job_url], text=True))
        if not results.results:
            logger.info("exa.jd_no_content", url=job_url)
            return None
        content = results.results[0].text or ""
        person  = _parse_hiring_team(content)
        if person:
            logger.info("exa.hiring_team_extracted", url=job_url, name=person["name"])
        else:
            logger.info("exa.hiring_team_not_in_content", url=job_url)
        return person
    except Exception as exc:
        msg = str(exc)
        if "429" in msg or "rate" in msg.lower():
            raise ProxycurlRateLimitError("Exa rate limit hit") from exc
        logger.debug("exa.jd_extract_error", url=job_url, error=msg[:100])
        return None


async def search_person_email(name: str, company: str, api_key: str) -> str | None:
    """Search the open web for a person's professional email address via Exa.

    Searches for their name + company across conference registrations, GitHub
    profiles, company team pages, and other public sources where people
    voluntarily share their email.  Returns the first plausible email found,
    or None if nothing is discovered.
    """
    import re
    if not api_key or not name:
        return None

    EMAIL_RE = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
    _GENERIC  = frozenset(["noreply", "no-reply", "info", "contact", "support",
                            "admin", "hello", "team", "careers", "jobs", "hr"])

    query = f'"{name}" {company} email'
    try:
        exa     = _exa_client(api_key)
        results = await _exa_call(lambda: exa.search(query, num_results=5))
        for result in (results.results or []):
            text = " ".join(filter(None, [
                result.title or "",
                getattr(result, "text", "") or "",
                result.url or "",
            ]))
            for match in EMAIL_RE.findall(text):
                local = match.split("@")[0].lower()
                if any(g in local for g in _GENERIC):
                    continue
                if "linkedin" in local or len(local) > 40 or local.count("-") > 3:
                    continue
                logger.info("exa.email_found_in_web", name=name, email=match)
                return match
    except Exception as exc:
        logger.debug("exa.search_email_error", name=name, error=str(exc)[:100])
    return None


async def research_person(name: str, company: str, api_key: str) -> str:
    """Real-time Exa search for a person's recent professional context.

    Returns bullet-point titles of up to 3 search results, or empty string
    if nothing is found or the API call fails.
    """
    if not api_key or not name:
        return ""
    query = f"{name} {company} professional insights career"
    try:
        exa     = _exa_client(api_key)
        results = await _exa_call(lambda: exa.search(query, num_results=3))
        items   = [r.title for r in results.results if r.title][:3]
        snippet = "\n".join(f"• {t}" for t in items)
        logger.info("exa.person_research", name=name, found=len(items))
        return snippet
    except Exception as exc:
        logger.debug("exa.research_person_error", name=name, error=str(exc)[:100])
        return ""


async def research_company(company: str, api_key: str, job_context: str = "") -> str:
    """Real-time Exa search for recent company news relevant to the job function.

    Uses job_context (typically the job title) to bias results toward relevant
    business activity — e.g. "sales growth" for a Sales role, "product launch"
    for a Product role. Falls back to generic company news if no context given.

    Returns bullet-point titles of up to 3 search results, or empty string
    if nothing is found or the API call fails.
    """
    if not api_key or not company:
        return ""
    # Build a query that finds recent company news for the specific job domain
    context_hint = job_context.strip() if job_context else "strategy leadership innovation"
    query = f"{company} {context_hint} news 2025"
    try:
        exa     = _exa_client(api_key)
        results = await _exa_call(lambda: exa.search(query, num_results=3))
        items   = [r.title for r in results.results if r.title][:3]
        snippet = "\n".join(f"• {t}" for t in items)
        logger.info("exa.company_research", company=company, found=len(items))
        return snippet
    except Exception as exc:
        logger.debug("exa.research_company_error", company=company, error=str(exc)[:100])
        return ""
