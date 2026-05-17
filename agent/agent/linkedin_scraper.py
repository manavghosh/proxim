"""Open-source LinkedIn data client using linkedin-api (tomquirk/linkedin-api).

Drop-in replacement for proxycurl.py — same function signatures, same return shapes.
Uses your personal LinkedIn credentials stored in agent/.env:
  LINKEDIN_SCRAPER_EMAIL=your@email.com
  LINKEDIN_SCRAPER_PASSWORD=yourpassword

Risk: violates LinkedIn ToS. Use only for personal dev/testing, not production.
Rate-limit yourself to ~50 calls/day to avoid account flags.
"""
from __future__ import annotations

import os
from typing import Optional
import structlog

logger = structlog.get_logger(__name__)

# Sentinel so we only initialise the client once per process
_api = None


class ProxycurlRateLimitError(Exception):
    """Re-exported so nodes don't care which client is active."""


def _client():
    global _api
    if _api is None:
        from linkedin_api import Linkedin  # pip install linkedin-api
        email    = os.getenv("LINKEDIN_SCRAPER_EMAIL", "")
        password = os.getenv("LINKEDIN_SCRAPER_PASSWORD", "")
        if not email or not password:
            raise RuntimeError(
                "Set LINKEDIN_SCRAPER_EMAIL and LINKEDIN_SCRAPER_PASSWORD in agent/.env"
            )
        _api = Linkedin(email, password)
        logger.info("linkedin_scraper.authenticated", email=email)
    return _api


async def search_employees(
    company_name: str,
    role: str,
    api_key: str = "",           # ignored — kept for interface compat
) -> Optional[dict]:
    """Search for an employee at a company by role title.

    Returns the first match in Proxycurl-compatible shape, or None.
    """
    try:
        api = _client()

        # Find the company's LinkedIn ID first
        companies = api.search_companies(keywords=company_name)
        if not companies:
            logger.info("linkedin_scraper.company_not_found", company=company_name)
            return None

        company_urn = companies[0].get("urn_id", "")

        # Search people at that company with the target role
        people = api.search_people(
            keywords=role,
            companies=[company_urn],
        )
        if not people:
            logger.info("linkedin_scraper.no_match", company=company_name, role=role)
            return None

        person = people[0]
        profile_id = person.get("public_id") or person.get("urn_id", "")

        logger.info(
            "linkedin_scraper.employee_found",
            company=company_name,
            role=role,
            name=person.get("name"),
            credits_consumed=0,   # free
        )
        return {
            "name":        person.get("name"),
            "title":       person.get("jobtitle") or role,
            "profile_url": f"https://www.linkedin.com/in/{profile_id}",
        }
    except Exception as exc:
        logger.error("linkedin_scraper.search_error", company=company_name,
                     role=role, error=str(exc))
        return None


async def enrich_profile(
    linkedin_url: str,
    api_key: str = "",           # ignored
) -> Optional[dict]:
    """Fetch full profile enrichment in Proxycurl-compatible shape."""
    try:
        api = _client()

        # Extract public_id from URL  e.g. linkedin.com/in/alice-zhang → alice-zhang
        public_id = linkedin_url.rstrip("/").split("/in/")[-1].split("?")[0]

        raw = api.get_profile(public_id=public_id)
        if not raw:
            return None

        # Map to ProxycurlPersonEnrichment shape
        experiences = [
            {
                "title":     exp.get("title", ""),
                "company":   (exp.get("company") or {}).get("name", ""),
                "starts_at": _date(exp.get("timePeriod", {}).get("startDate")),
                "ends_at":   _date(exp.get("timePeriod", {}).get("endDate")),
            }
            for exp in raw.get("experience", [])
        ]
        education = [
            {
                "degree_name": edu.get("degreeName"),
                "school":      {"name": edu.get("schoolName", "")},
                "ends_at":     _date(edu.get("timePeriod", {}).get("endDate")),
            }
            for edu in raw.get("education", [])
        ]

        logger.info(
            "linkedin_scraper.profile_enriched",
            url=linkedin_url,
            full_name=raw.get("firstName", "") + " " + raw.get("lastName", ""),
            credits_consumed=0,
        )
        return {
            "full_name":   f"{raw.get('firstName', '')} {raw.get('lastName', '')}".strip(),
            "headline":    raw.get("headline"),
            "summary":     raw.get("summary"),
            "experiences": experiences,
            "education":   education,
        }
    except Exception as exc:
        logger.error("linkedin_scraper.enrich_error", url=linkedin_url, error=str(exc))
        return None


def _date(d: dict | None) -> dict | None:
    if not d:
        return None
    return {"year": d.get("year", 0), "month": d.get("month", 1), "day": 1}
