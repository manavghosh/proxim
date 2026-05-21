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


async def verify_email(email: str, api_key: str) -> str:
    """Verify a single email address via Hunter.io Email Verifier.

    Returns one of: 'deliverable', 'risky', 'undeliverable', 'unknown'.
    Returns 'unknown' on any API or network error so callers can decide
    whether to fall back or discard.
    """
    if not email or not api_key:
        return "unknown"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{HUNTER_BASE}/email-verifier",
                params={"email": email, "api_key": api_key},
            )
        if resp.status_code == 429:
            raise HunterRateLimitError("Hunter.io rate limit exceeded")
        if resp.status_code != 200:
            logger.warning("hunter_io.verify_failed", email=email, status=resp.status_code)
            return "unknown"
        status = resp.json().get("data", {}).get("status", "unknown")
        logger.info("hunter_io.verify_email", email=email, status=status)
        return status
    except HunterRateLimitError:
        raise
    except Exception as exc:
        logger.warning("hunter_io.verify_error", email=email, error=str(exc)[:100])
        return "unknown"


async def infer_domain_pattern(domain: str, api_key: str) -> str | None:
    """Infer the most common email pattern used by a company's domain.

    Examines known emails from a domain search and returns a pattern key
    such as 'first.last', 'flast', 'firstlast', 'f.last', or 'first'.
    Returns None when insufficient data is available.
    """
    results = await domain_search(domain, api_key)
    pattern_votes: dict[str, int] = {}

    for entry in results[:8]:
        email = (entry.get("value") or entry.get("email") or "").lower()
        first = (entry.get("first_name") or "").lower().strip()
        last  = (entry.get("last_name")  or "").lower().strip()
        if not email or not first or not last or "@" not in email:
            continue
        local = email.split("@")[0]
        if   local == f"{first}.{last}":     pattern_votes["first.last"]  = pattern_votes.get("first.last",  0) + 1
        elif local == f"{first}{last}":       pattern_votes["firstlast"]   = pattern_votes.get("firstlast",   0) + 1
        elif local == f"{first[0]}{last}":    pattern_votes["flast"]       = pattern_votes.get("flast",       0) + 1
        elif local == f"{first[0]}.{last}":   pattern_votes["f.last"]      = pattern_votes.get("f.last",      0) + 1
        elif local == first:                  pattern_votes["first"]        = pattern_votes.get("first",       0) + 1
        elif local == f"{first}_{last}":      pattern_votes["first_last"]  = pattern_votes.get("first_last",  0) + 1

    if not pattern_votes:
        return None
    best = max(pattern_votes, key=lambda k: pattern_votes[k])
    logger.info("hunter_io.pattern_inferred", domain=domain, pattern=best, votes=pattern_votes)
    return best


def generate_email_candidates(
    first_name: str,
    last_name: str,
    domain: str,
    known_pattern: str | None = None,
) -> list[str]:
    """Generate candidate email addresses for a person at a domain.

    Puts the known pattern first (highest probability), followed by the
    most common patterns in frequency order. Deduplicates automatically.
    """
    f = first_name.lower().strip()
    l = last_name.lower().strip()
    if not f or not l:
        return []

    pattern_map = {
        "first.last":  f"{f}.{l}@{domain}",
        "firstlast":   f"{f}{l}@{domain}",
        "flast":        f"{f[0]}{l}@{domain}",
        "f.last":       f"{f[0]}.{l}@{domain}",
        "first":        f"{f}@{domain}",
        "first_last":  f"{f}_{l}@{domain}",
    }
    ordered_keys = ["first.last", "firstlast", "flast", "f.last", "first", "first_last"]

    if known_pattern and known_pattern in pattern_map:
        ordered_keys = [known_pattern] + [k for k in ordered_keys if k != known_pattern]

    seen: set[str] = set()
    result: list[str] = []
    for key in ordered_keys:
        addr = pattern_map[key]
        if addr not in seen:
            seen.add(addr)
            result.append(addr)
    return result
