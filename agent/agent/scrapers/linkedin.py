"""LinkedIn job scraper — search results with stealth Playwright."""
import asyncio
import random
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/search/"
LINKEDIN_BASE     = "https://www.linkedin.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _extract_date(card) -> str | None:
    el = card.select_one("time.job-search-card__listdate, time[datetime]")
    if el:
        return el.get("datetime")
    return None


def _parse_cards(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for card in soup.select(".job-search-card"):
        title_el   = card.select_one(".base-search-card__title")
        company_el = card.select_one(".base-search-card__subtitle")
        loc_el     = card.select_one(".job-search-card__location")
        link_el    = card.select_one("a.base-card__full-link")

        if not title_el or not link_el:
            continue

        href = link_el.get("href", "")
        if isinstance(href, list):
            href = href[0] if href else ""
        if not href:
            continue

        job_url = href if href.startswith("http") else f"{LINKEDIN_BASE}{href}"
        # Strip LinkedIn tracking params — keep canonical URL for dedup
        if "?" in job_url:
            job_url = job_url.split("?")[0]

        results.append({
            "title":     title_el.get_text(strip=True),
            "company":   company_el.get_text(strip=True) if company_el else "",
            "location":  loc_el.get_text(strip=True) if loc_el else None,
            "url":       job_url,
            "posted_at": _extract_date(card),
        })
    return results


class LinkedInScraper(AbstractScraper):
    source_name = "linkedin"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        geo = preferences.get("geographic_preference", [])
        location = geo[0].replace("-based", "").strip() if geo else "India"

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            context = await browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1920, "height": 1080},
                locale="en-IN",
            )
            try:
                page = await context.new_page()
                await stealth_async(page)

                for query in queries[:3]:
                    for page_num in [1, 2]:
                        try:
                            start = (page_num - 1) * 25
                            encoded_q   = query.replace(" ", "%20")
                            encoded_loc = location.replace(" ", "%20")
                            url = (
                                f"{LINKEDIN_JOBS_URL}"
                                f"?keywords={encoded_q}"
                                f"&location={encoded_loc}"
                                f"&f_TPR=r604800"
                                f"&start={start}"
                            )
                            await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                            try:
                                await page.wait_for_selector(".job-search-card", timeout=10000)
                            except Exception:
                                break  # no cards → last page reached

                            html   = await page.content()
                            parsed = _parse_cards(html)

                            for item in parsed:
                                if item["url"] in seen_urls:
                                    continue
                                seen_urls.add(item["url"])
                                jobs.append(RawJob(
                                    title=item["title"],
                                    company=item["company"],
                                    location=item["location"],
                                    jd_raw="",      # JD fetched by fetch_jds pipeline job
                                    source="linkedin",
                                    source_url=item["url"],
                                    application_url=item["url"],
                                    posted_at=item["posted_at"],
                                ))

                            if len(parsed) < 20:
                                break   # fewer than a full page → stop paginating

                            await asyncio.sleep(random.uniform(2.0, 3.5))

                        except Exception as e:
                            logger.warning("linkedin_query_error",
                                           query=query, page=page_num, error=str(e))
                            break   # stop pagination for this query; try next query

                    await asyncio.sleep(random.uniform(1.5, 2.5))

            finally:
                await context.close()
                await browser.close()

        logger.info("linkedin_scrape_complete", jobs_found=len(jobs))
        return jobs
