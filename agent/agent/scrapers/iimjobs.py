"""iimjobs.com job scraper using requests + BeautifulSoup."""
import time
import requests
from bs4 import BeautifulSoup
import structlog
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

BASE_URL = "https://www.iimjobs.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


class IimjobsScraper(AbstractScraper):
    source_name = "iimjobs"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        for query in queries:
            slug = query.lower().replace(" ", "-")
            url = f"{BASE_URL}/j/{slug}-jobs"

            for page in range(1, 4):  # max 3 pages
                try:
                    page_url = url if page == 1 else f"{url}?page={page}"
                    resp = requests.get(page_url, headers=HEADERS, timeout=15)
                    resp.raise_for_status()
                    soup = BeautifulSoup(resp.text, "html.parser")

                    cards = soup.select("li.job-bx")
                    if not cards:
                        break

                    for card in cards:
                        link = card.select_one("h2 a")
                        if not link:
                            continue
                        title = link.get_text(strip=True)
                        raw_href = link.get("href", "")
                        href = raw_href[0] if isinstance(raw_href, list) else (raw_href or "")
                        job_url = href if href.startswith("http") else f"{BASE_URL}{href}"

                        if job_url in seen_urls:
                            continue
                        seen_urls.add(job_url)

                        company = card.select_one(".company")
                        location = card.select_one(".location")
                        desc = card.select_one(".job-desc")

                        jobs.append(RawJob(
                            title=title,
                            company=company.get_text(strip=True) if company else "",
                            location=location.get_text(strip=True) if location else None,
                            jd_raw=desc.get_text(strip=True) if desc else "",
                            source="iimjobs",
                            source_url=job_url,
                            application_url=job_url,
                        ))

                    # Check for next page marker
                    next_page = soup.select_one(".next-page")
                    if not next_page:
                        break

                    time.sleep(1.5)

                except Exception as e:
                    logger.warning("iimjobs_page_error", query=query, page=page, error=str(e))
                    break

        return jobs
