"""LinkedIn data client using Exa AI people search.

Proxycurl was shut down July 2026 (LinkedIn lawsuit). This module is a
drop-in replacement using Exa's people search API — same function signatures,
same return shapes, zero breaking changes to any node or daemon code.

Sign up for a free key (1,000 req/month) at https://exa.ai
Add to agent/.env:  EXA_API_KEY=your_key_here
"""
from __future__ import annotations

from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


class ProxycurlRateLimitError(Exception):
    """Raised when the upstream API returns a rate-limit response."""


def _exa_client(api_key: str):
    from exa_py import Exa  # pip install exa_py
    return Exa(api_key=api_key)


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
        results = exa.search(
            query,
            category="people",
            num_results=1,
        )

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
        results = exa.get_contents(
            [linkedin_url],
            text=True,
        )

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
