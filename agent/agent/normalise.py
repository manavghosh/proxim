"""URL normalisation and job deduplication using rapidfuzz."""
from __future__ import annotations
import re
import string
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from rapidfuzz import fuzz
from agent.models import RawJob, NormalisedJob

# Query params to preserve during URL normalisation
KEEP_PARAMS = {"jobid", "id", "jobId"}

# Abbreviation expansions for dedup key normalisation
ABBREVIATIONS: dict[str, str] = {
    r"\bvp\b": "vice president",
    r"\bsr\b": "senior",
    r"\bjr\b": "junior",
    r"\bmgr\b": "manager",
    r"\bdir\b": "director",
    r"\beng\b": "engineering",
    r"\bai\b": "artificial intelligence",
    r"\bml\b": "machine learning",
    r"\bcto\b": "chief technology officer",
    r"\bcaio\b": "chief artificial intelligence officer",
}

FUZZY_THRESHOLD = 85


def normalise_url(url: str) -> str:
    """Lowercase URL and strip tracking query parameters."""
    url = url.lower()
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=False)
    # Keep only whitelisted params
    filtered = {k: v for k, v in params.items() if k.lower() in KEEP_PARAMS}
    new_query = urlencode(filtered, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def build_dedup_key(company: str, title: str) -> str:
    """Build a normalised dedup key from company + title."""
    text = f"{company} {title}".lower()
    # Expand abbreviations
    for pattern, replacement in ABBREVIATIONS.items():
        text = re.sub(pattern, replacement, text)
    # Remove punctuation
    text = text.translate(str.maketrans("", "", string.punctuation))
    # Collapse whitespace
    return " ".join(text.split())


def is_fuzzy_duplicate(key_a: str, key_b: str, threshold: int = FUZZY_THRESHOLD) -> bool:
    """Return True if two dedup keys are similar enough to be the same role."""
    return fuzz.token_sort_ratio(key_a, key_b) >= threshold


def deduplicate_batch(
    jobs: list[RawJob],
    seen_urls: set[str],
    seen_keys: list[str],
) -> list[NormalisedJob]:
    """
    Deduplicate a batch of jobs against previously seen URLs and fuzzy keys.
    Modifies seen_urls and seen_keys in place for within-batch dedup.
    """
    results: list[NormalisedJob] = []

    for job in jobs:
        norm_url = normalise_url(job.source_url)
        dedup_key = build_dedup_key(job.company, job.title)
        jd_text = " ".join(job.jd_raw.split())  # normalise whitespace

        # 1. Exact URL dedup
        if norm_url in seen_urls:
            results.append(
                NormalisedJob(
                    **job.model_dump(),
                    jd_text=jd_text,
                    is_duplicate=True,
                    duplicate_of_url=norm_url,
                )
            )
            continue

        # 2. Fuzzy title+company dedup
        fuzzy_match: str | None = None
        for existing_key in seen_keys:
            if is_fuzzy_duplicate(dedup_key, existing_key):
                fuzzy_match = existing_key
                break

        if fuzzy_match:
            results.append(
                NormalisedJob(
                    **job.model_dump(),
                    jd_text=jd_text,
                    is_duplicate=True,
                    duplicate_of_url=None,
                )
            )
            seen_urls.add(norm_url)  # track so same URL doesn't appear again
            continue

        # New job
        seen_urls.add(norm_url)
        seen_keys.append(dedup_key)
        results.append(
            NormalisedJob(
                **job.model_dump(),
                jd_text=jd_text,
                is_duplicate=False,
            )
        )

    return results
