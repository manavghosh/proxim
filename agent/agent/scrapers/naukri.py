"""Naukri.com job scraper using the undocumented JSON search endpoint."""
import requests
import structlog
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

NAUKRI_API_URL = "https://www.naukri.com/jobapi/v3/search"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "appid": "109",
    "systemid": "109",
}


class NaukriScraper(AbstractScraper):
    source_name = "naukri"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        for query in queries:
            try:
                params = {
                    "noOfResults": 50,
                    "urlType": "search_by_keyword",
                    "searchType": "adv",
                    "keyword": query,
                    "jobAge": 3,
                }
                resp = requests.get(NAUKRI_API_URL, params=params, headers=HEADERS, timeout=15)
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("jobDetails", []):
                    title = item.get("title")
                    if not title:
                        continue
                    url = item.get("jdURL", "")
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)

                    jobs.append(RawJob(
                        title=title,
                        company=item.get("companyName", ""),
                        location=item.get("location"),
                        jd_raw=item.get("jobDescription", ""),
                        source="naukri",
                        source_url=url,
                        application_url=url,
                    ))
            except Exception as e:
                logger.warning("naukri_query_error", query=query, error=str(e))

        return jobs
