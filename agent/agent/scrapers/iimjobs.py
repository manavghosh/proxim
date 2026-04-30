"""iimjobs.com job scraper using requests + BeautifulSoup."""
import time
import requests
from bs4 import BeautifulSoup
import structlog
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

BASE_URL = "https://www.iimjobs.com"
SEARCH_URL = "https://www.iimjobs.com/j/search"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.iimjobs.com/",
}


class IimjobsScraper(AbstractScraper):
    source_name = "iimjobs"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        # iimjobs search uses ?search_keyword= or ?q= query params
        searched_queries: set[str] = set()
        for query in queries:
            if query in searched_queries:
                continue
            searched_queries.add(query)

            for page in range(1, 3):  # max 2 pages per query
                try:
                    params: dict = {"search_keyword": query}
                    if page > 1:
                        params["page"] = page

                    resp = requests.get(
                        SEARCH_URL,
                        params=params,
                        headers=HEADERS,
                        timeout=15,
                    )
                    resp.raise_for_status()
                    soup = BeautifulSoup(resp.text, "html.parser")

                    # iimjobs uses multiple possible card selectors
                    cards = (
                        soup.select("li.job-bx")
                        or soup.select(".job-listing")
                        or soup.select("article.job")
                        or soup.select(".jobItem")
                    )

                    if not cards:
                        logger.debug("iimjobs_no_cards", query=query, page=page)
                        break

                    for card in cards:
                        link = card.select_one("h2 a, h3 a, .job-title a, a.job-link")
                        if not link:
                            continue
                        title = link.get_text(strip=True)
                        if not title:
                            continue

                        raw_href = link.get("href", "")
                        href = raw_href[0] if isinstance(raw_href, list) else (raw_href or "")
                        job_url = href if href.startswith("http") else f"{BASE_URL}{href}"

                        if job_url in seen_urls:
                            continue
                        seen_urls.add(job_url)

                        company_el = card.select_one(".company, .employer, .comp-name")
                        location_el = card.select_one(".location, .loc, .job-loc")
                        desc_el = card.select_one(".job-desc, .desc, .snippet")

                        jobs.append(RawJob(
                            title=title,
                            company=company_el.get_text(strip=True) if company_el else "",
                            location=location_el.get_text(strip=True) if location_el else None,
                            jd_raw=desc_el.get_text(strip=True) if desc_el else "",
                            source="iimjobs",
                            source_url=job_url,
                            application_url=job_url,
                        ))

                    # Check for pagination
                    has_next = soup.select_one(".next-page, .pagination .next, a[rel='next']")
                    if not has_next:
                        break

                    time.sleep(1.5)

                except Exception as e:
                    logger.warning("iimjobs_page_error", query=query, page=page, error=str(e))
                    break

        logger.info("iimjobs_scrape_complete", jobs_found=len(jobs))
        return jobs
