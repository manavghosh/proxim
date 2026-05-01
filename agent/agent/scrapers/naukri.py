"""Naukri.com job scraper using the internal JSON search API.

The HTML search pages are protected by Akamai EdgeSuite WAF which blocks
headless browsers at the network layer. The JSON API used by Naukri's own
SPA is accessible with standard HTTP headers and returns structured data.
"""
import asyncio
import structlog
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

SEARCH_API = "https://www.naukri.com/jobapi/v3/search"
JOB_BASE   = "https://www.naukri.com"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json",
    "Content-Type":    "application/json",
    "appid":           "109",
    "systemid":        "109",
    "Referer":         "https://www.naukri.com/",
    "Origin":          "https://www.naukri.com",
}


def _search(keyword: str, location: str, page: int = 1) -> list[dict]:
    """Synchronous Naukri API call — run in thread pool from async code."""
    import requests

    params = {
        "noOfResults": 20,
        "urlType":     "search_by_keyword",
        "searchType":  "adv",
        "keyword":     keyword,
        "location":    location,
        "pageNo":      page,
        "src":         "directsearch",
    }

    resp = requests.get(SEARCH_API, params=params, headers=HEADERS, timeout=15)
    resp.raise_for_status()

    data = resp.json()
    return data.get("jobDetails", [])


def _extract_location(job: dict) -> str | None:
    """Pull location from the jobLocation list or placeholders."""
    locs = job.get("jobLocation") or []
    if locs:
        return ", ".join(str(l) for l in locs[:2])
    # fallback: scan placeholders
    for ph in job.get("placeholders", []):
        if ph.get("type") == "location":
            return ph.get("label")
    return None


def _extract_job_url(job: dict) -> str:
    jd_url = job.get("jdURL", "")
    if jd_url.startswith("http"):
        return jd_url
    if jd_url:
        return f"{JOB_BASE}{jd_url}"
    job_id = job.get("jobId", "")
    return f"{JOB_BASE}/job-listings-{job_id}" if job_id else JOB_BASE


class NaukriScraper(AbstractScraper):
    source_name = "naukri"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:
        jobs: list[RawJob]  = []
        seen_urls: set[str] = set()

        # Extract location hint from preferences for the API location param
        geo: list[str] = preferences.get("geographic_preference", [])
        location = geo[0].replace("-based", "").strip() if geo else "india"

        for query in queries[:5]:
            try:
                logger.debug("naukri_api_query", keyword=query, location=location)
                raw_jobs = await asyncio.to_thread(_search, query, location)

                for job in raw_jobs:
                    url = _extract_job_url(job)
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)

                    title   = job.get("title", "").strip()
                    company = job.get("companyName", "").strip()
                    if not title or not company:
                        continue

                    jobs.append(RawJob(
                        title=title,
                        company=company,
                        location=_extract_location(job),
                        jd_raw=job.get("jobDescription", ""),
                        source="naukri",
                        source_url=url,
                        application_url=url,
                    ))

                logger.debug("naukri_query_done", query=query, found=len(raw_jobs))
                await asyncio.sleep(0.5)   # polite delay between API calls

            except Exception as e:
                logger.warning("naukri_query_error", query=query, error=str(e))
                continue

        logger.info("naukri_scrape_complete", jobs_found=len(jobs))
        return jobs
