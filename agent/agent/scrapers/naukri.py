"""Naukri.com job scraper using the JSON search endpoint."""
import requests
import structlog
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

NAUKRI_SEARCH_URL = "https://www.naukri.com/jobapi/v3/search"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.naukri.com/",
    "Origin": "https://www.naukri.com",
    "appid": "109",
    "systemid": "Naukri",
    "x-requested-with": "XMLHttpRequest",
    "Content-Type": "application/json",
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
                    "jobAge": 7,
                    "location": "india",
                    "k": query,
                    "l": "",
                    "nignBeaconTag": "searchResultPage",
                }
                resp = requests.get(
                    NAUKRI_SEARCH_URL,
                    params=params,
                    headers=HEADERS,
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("jobDetails", []):
                    title = item.get("title")
                    if not title:
                        continue
                    url = item.get("jdURL", "")
                    if not url or url in seen_urls:
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

        logger.info("naukri_scrape_complete", jobs_found=len(jobs))
        return jobs
