"""LinkedIn job scraper using Playwright with stealth mode."""
import random
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

LINKEDIN_BASE = "https://www.linkedin.com"
LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/search/"


class LinkedInScraper(AbstractScraper):
    source_name = "linkedin"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.set_extra_http_headers({
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    )
                })

                for query in queries[:3]:  # limit to 3 queries per run
                    try:
                        url = f"{LINKEDIN_JOBS_URL}?keywords={query}&location=India&f_TPR=r604800"
                        await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                        # Wait for job cards — if this times out, likely rate-limited
                        await page.wait_for_selector(".job-search-card", timeout=10000)

                        html = await page.content()
                        soup = BeautifulSoup(html, "html.parser")

                        for card in soup.select(".job-search-card"):
                            title_el = card.select_one(".base-search-card__title")
                            company_el = card.select_one(".base-search-card__subtitle")
                            location_el = card.select_one(".job-search-card__location")
                            link_el = card.select_one(".base-card__full-link")

                            if not title_el or not link_el:
                                continue

                            raw_href = link_el.get("href", "")
                            href = raw_href[0] if isinstance(raw_href, list) else (raw_href or "")
                            job_url = href if href.startswith("http") else f"{LINKEDIN_BASE}{href}"

                            if job_url in seen_urls:
                                continue
                            seen_urls.add(job_url)

                            jobs.append(RawJob(
                                title=title_el.get_text(strip=True),
                                company=company_el.get_text(strip=True) if company_el else "",
                                location=location_el.get_text(strip=True) if location_el else None,
                                jd_raw="",  # JD fetched separately if needed
                                source="linkedin",
                                source_url=job_url,
                                application_url=job_url,
                            ))

                        # Human-like delay between queries
                        delay_ms = random.randint(2000, 4000)
                        await page.wait_for_timeout(delay_ms)

                    except Exception as e:
                        logger.warning("linkedin_query_error", query=query, error=str(e))
                        # 429 or CAPTCHA — skip remaining queries for this run
                        break
            finally:
                await browser.close()

        logger.info("linkedin_scrape_complete", jobs_found=len(jobs))
        return jobs
