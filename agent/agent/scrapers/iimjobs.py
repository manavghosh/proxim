"""iimjobs.com job scraper using Playwright (headless browser)."""
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

IIMJOBS_BASE = "https://www.iimjobs.com"
IIMJOBS_SEARCH_URL = "https://www.iimjobs.com/j/search"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class IimjobsScraper(AbstractScraper):
    source_name = "iimjobs"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.set_extra_http_headers({"User-Agent": USER_AGENT})

                for query in queries[:5]:
                    try:
                        url = f"{IIMJOBS_SEARCH_URL}?search_keyword={query.replace(' ', '+')}"
                        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        await page.wait_for_selector(".job-bx", timeout=10000)

                        html = await page.content()
                        soup = BeautifulSoup(html, "html.parser")

                        for card in soup.select(".job-bx"):
                            link_el = card.select_one("h2 a, h3 a, .job-title a")
                            if not link_el:
                                continue

                            title = link_el.get_text(strip=True)
                            if not title:
                                continue

                            raw_href = link_el.get("href", "")
                            href = raw_href[0] if isinstance(raw_href, list) else (raw_href or "")
                            job_url = href if href.startswith("http") else f"{IIMJOBS_BASE}{href}"

                            if job_url in seen_urls:
                                continue
                            seen_urls.add(job_url)

                            company_el = card.select_one(".company")
                            location_el = card.select_one(".location")
                            desc_el = card.select_one(".job-desc")

                            jobs.append(RawJob(
                                title=title,
                                company=company_el.get_text(strip=True) if company_el else "",
                                location=location_el.get_text(strip=True) if location_el else None,
                                jd_raw=desc_el.get_text(strip=True) if desc_el else "",
                                source="iimjobs",
                                source_url=job_url,
                                application_url=job_url,
                            ))

                        await page.wait_for_timeout(2000)

                    except Exception as e:
                        logger.warning("iimjobs_query_error", query=query, error=str(e))
                        break
            finally:
                await browser.close()

        logger.info("iimjobs_scrape_complete", jobs_found=len(jobs))
        return jobs
