"""Naukri.com job scraper using Playwright (headless browser)."""
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

NAUKRI_BASE = "https://www.naukri.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class NaukriScraper(AbstractScraper):
    source_name = "naukri"

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
                        slug = query.lower().replace(" ", "-")
                        url = f"{NAUKRI_BASE}/{slug}-jobs"
                        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        await page.wait_for_selector(".jobTuple", timeout=10000)

                        html = await page.content()
                        soup = BeautifulSoup(html, "html.parser")

                        for card in soup.select(".jobTuple"):
                            title_el = card.select_one(".title")
                            company_el = card.select_one(".subTitle")
                            location_el = card.select_one(".locWdth")
                            desc_el = card.select_one(".job-description")

                            if not title_el:
                                continue

                            raw_href = title_el.get("href", "")
                            href = raw_href[0] if isinstance(raw_href, list) else (raw_href or "")
                            if not href:
                                continue
                            job_url = href if href.startswith("http") else f"{NAUKRI_BASE}{href}"

                            if job_url in seen_urls:
                                continue
                            seen_urls.add(job_url)

                            jobs.append(RawJob(
                                title=title_el.get_text(strip=True),
                                company=company_el.get_text(strip=True) if company_el else "",
                                location=location_el.get_text(strip=True) if location_el else None,
                                jd_raw=desc_el.get_text(strip=True) if desc_el else "",
                                source="naukri",
                                source_url=job_url,
                                application_url=job_url,
                            ))

                        await page.wait_for_timeout(2000)

                    except Exception as e:
                        logger.warning("naukri_query_error", query=query, error=str(e))
                        break
            finally:
                await browser.close()

        logger.info("naukri_scrape_complete", jobs_found=len(jobs))
        return jobs
