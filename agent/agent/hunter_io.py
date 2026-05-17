"""Async Hunter.io email discovery client."""
from __future__ import annotations

import structlog
import httpx

logger = structlog.get_logger()

HUNTER_BASE = "https://api.hunter.io/v2"


class HunterRateLimitError(Exception):
    pass


async def find_email(
    domain: str,
    first_name: str,
    last_name: str,
    api_key: str,
) -> dict | None:
    """Email Finder — person-level lookup. Returns {email, score} or None."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{HUNTER_BASE}/email-finder",
            params={"domain": domain, "first_name": first_name, "last_name": last_name, "api_key": api_key},
        )

    if resp.status_code == 429:
        raise HunterRateLimitError("Hunter.io rate limit exceeded")

    if resp.status_code != 200:
        logger.warning("hunter_io.find_email_failed", status=resp.status_code, domain=domain)
        return None

    data = resp.json().get("data", {})
    email = data.get("email")
    score = data.get("score", 0)
    logger.info("hunter_io.find_email", domain=domain, email_found=bool(email), confidence=score, source="finder")
    if not email:
        return None
    return {"email": email, "score": score}


async def domain_search(domain: str, api_key: str) -> list[dict]:
    """Domain Search — returns list of addresses sorted by confidence descending."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{HUNTER_BASE}/domain-search",
            params={"domain": domain, "limit": 10, "api_key": api_key},
        )

    if resp.status_code == 429:
        raise HunterRateLimitError("Hunter.io rate limit exceeded")

    if resp.status_code != 200:
        logger.warning("hunter_io.domain_search_failed", status=resp.status_code, domain=domain)
        return []

    emails = resp.json().get("data", {}).get("emails", [])
    personal = [e for e in emails if e.get("type") == "personal"]
    result = sorted(personal, key=lambda e: e.get("confidence", 0), reverse=True)
    logger.info("hunter_io.domain_search", domain=domain, candidates=len(result))
    return result
