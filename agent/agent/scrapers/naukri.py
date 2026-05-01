"""Naukri.com job scraper using Playwright with stealth mode."""
import asyncio
import random
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, BrowserContext
from playwright_stealth import stealth_async
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

NAUKRI_BASE = "https://www.naukri.com"

# Realistic Chrome UA on Windows
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Multiple CSS selector strategies — Naukri updates their classes periodically
JOB_CARD_SELECTORS = [
    "article.jobTuple",
    ".srp-jobtuple-wrapper",
    ".jobTupleHeader",
    "[data-job-id]",
]

TITLE_SELECTORS   = [".title", ".row1 .title", "a.title", "h2.title"]
COMPANY_SELECTORS = [".subTitle", ".comp-name", ".companyInfo .subTitle"]
LOCATION_SELECTORS = [".locWdth", ".location", ".loc"]
DESC_SELECTORS    = [".job-description", ".jobDesc", ".jd"]


def _first_text(soup_el, selectors: list[str]) -> str:
    for sel in selectors:
        el = soup_el.select_one(sel)
        if el:
            return el.get_text(strip=True)
    return ""


def _first_href(soup_el, selectors: list[str]) -> str:
    for sel in selectors:
        el = soup_el.select_one(sel)
        if el:
            href = el.get("href", "")
            if isinstance(href, list):
                href = href[0] if href else ""
            return href
    return ""


async def _make_context(playwright) -> tuple:
    """Launch browser + context with stealth settings."""
    browser = await playwright.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-infobars",
            "--window-size=1920,1080",
        ],
    )
    context = await browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1920, "height": 1080},
        locale="en-IN",
        timezone_id="Asia/Kolkata",
        extra_http_headers={
            "Accept-Language": "en-IN,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
        },
    )
    # Block images and fonts to speed up loading
    await context.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}", lambda r: r.abort())
    return browser, context


def _parse_job_cards(html: str) -> list[dict]:
    """Parse job listings from page HTML, trying multiple selector strategies."""
    soup = BeautifulSoup(html, "html.parser")

    cards = []
    for sel in JOB_CARD_SELECTORS:
        found = soup.select(sel)
        if found:
            cards = found
            logger.debug("naukri_selector_matched", selector=sel, count=len(found))
            break

    results = []
    for card in cards:
        title_el = None
        for sel in TITLE_SELECTORS:
            title_el = card.select_one(sel)
            if title_el:
                break
        if not title_el:
            continue

        href = title_el.get("href", "")
        if isinstance(href, list):
            href = href[0] if href else ""
        if not href:
            # Try sibling <a> tags
            link = card.select_one("a[href*='naukri.com'], a[href^='/']")
            href = link.get("href", "") if link else ""

        if not href:
            continue

        job_url = href if href.startswith("http") else f"{NAUKRI_BASE}{href}"
        results.append({
            "title":   title_el.get_text(strip=True),
            "company": _first_text(card, COMPANY_SELECTORS),
            "location": _first_text(card, LOCATION_SELECTORS) or None,
            "jd_raw":  _first_text(card, DESC_SELECTORS),
            "url":     job_url,
        })
    return results


class NaukriScraper(AbstractScraper):
    source_name = "naukri"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        async with async_playwright() as pw:
            browser, context = await _make_context(pw)
            try:
                page = await context.new_page()
                await stealth_async(page)  # mask all headless indicators

                # Warm-up: visit homepage first to get cookies/session
                try:
                    await page.goto(NAUKRI_BASE, wait_until="domcontentloaded", timeout=20000)
                    await asyncio.sleep(random.uniform(1.5, 2.5))
                except Exception:
                    pass

                for query in queries[:5]:
                    try:
                        slug = query.lower().replace(" ", "-")
                        url = f"{NAUKRI_BASE}/{slug}-jobs"
                        logger.debug("naukri_fetching", url=url)

                        await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                        # Wait for any known job card selector
                        found_selector = None
                        for sel in JOB_CARD_SELECTORS:
                            try:
                                await page.wait_for_selector(sel, timeout=8000)
                                found_selector = sel
                                break
                            except Exception:
                                continue

                        if not found_selector:
                            logger.warning("naukri_no_cards", query=query, url=url)
                            continue

                        # Scroll to trigger lazy-load
                        await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
                        await asyncio.sleep(random.uniform(0.5, 1.0))

                        html = await page.content()
                        parsed = _parse_job_cards(html)

                        for item in parsed:
                            if item["url"] in seen_urls:
                                continue
                            seen_urls.add(item["url"])
                            jobs.append(RawJob(
                                title=item["title"],
                                company=item["company"],
                                location=item["location"],
                                jd_raw=item["jd_raw"],
                                source="naukri",
                                source_url=item["url"],
                                application_url=item["url"],
                            ))

                        logger.debug("naukri_query_done", query=query, found=len(parsed))
                        await asyncio.sleep(random.uniform(1.5, 3.0))

                    except Exception as e:
                        logger.warning("naukri_query_error", query=query, error=str(e))
                        continue  # try next query instead of aborting all
            finally:
                await context.close()
                await browser.close()

        logger.info("naukri_scrape_complete", jobs_found=len(jobs))
        return jobs
