"""LinkedIn JD scraper — visits individual job detail pages to extract full descriptions."""
import asyncio
import random
from typing import Callable, Awaitable
import structlog
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

logger = structlog.get_logger()

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Selectors tried in priority order on LinkedIn job detail pages
JD_SELECTORS = [
    "#job-details",
    ".description__text",
    ".show-more-less-html__markup",
    ".jobs-description__content",
    ".jobs-box__html-content",
]

TITLE_SELECTORS = [
    "h1.top-card-layout__title",
    "h1.jobs-unified-top-card__job-title",
    "h1",
]

COMPANY_SELECTORS = [
    ".topcard__org-name-link",
    ".jobs-unified-top-card__company-name a",
    ".jobs-unified-top-card__company-name",
    ".top-card-layout__card a[data-tracking-control-name='public_jobs_topcard-org-name']",
]

# Callback type: called immediately after each page is processed
OnFetchedCallback = Callable[[str, str], Awaitable[None]]


class LinkedInJdScraper:
    """Fetches job description text from LinkedIn job detail pages.

    Accepts an optional async `on_fetched(job_id, jd_text)` callback that is
    called immediately after each individual page is processed. This allows the
    caller to persist each JD to the database as soon as it is fetched, rather
    than waiting for the entire batch to complete.
    """

    async def fetch_jds(
        self,
        jobs: list[dict],
        on_fetched: OnFetchedCallback | None = None,
    ) -> list[tuple[str, str]]:
        """
        Visit each job's LinkedIn detail page and extract the JD text.

        For each job, calls `on_fetched(job_id, jd_text)` immediately after the
        page is processed — before moving to the next job. This ensures the DB
        is updated one row at a time so progress is not lost if the run crashes.

        Returns the full list of (job_id, jd_text) tuples when done.
        """
        results: list[tuple[str, str]] = []

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
            # Block images and fonts — only text content needed for JDs
            await context.route(
                "**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}",
                lambda r: r.abort(),
            )

            try:
                page = await context.new_page()
                await stealth_async(page)

                for job in jobs:
                    job_id = job["id"]
                    url    = job["source_url"]
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=20000)

                        jd_text = ""
                        for sel in JD_SELECTORS:
                            el = await page.query_selector(sel)
                            if el:
                                text = (await el.inner_text()).strip()
                                if text:
                                    jd_text = text
                                    break

                        # Extract title and company (used by import_jobs flow)
                        title = ""
                        for sel in TITLE_SELECTORS:
                            el = await page.query_selector(sel)
                            if el:
                                text = (await el.inner_text()).strip()
                                if text:
                                    title = text
                                    break

                        company = ""
                        for sel in COMPANY_SELECTORS:
                            el = await page.query_selector(sel)
                            if el:
                                text = (await el.inner_text()).strip()
                                if text:
                                    company = text
                                    break

                        results.append((job_id, jd_text))
                        words = len(jd_text.split()) if jd_text else 0
                        logger.debug("linkedin_jd_fetched",
                                     job_id=job_id, words=words, found=bool(jd_text),
                                     title=title[:60] if title else "")

                        # Persist immediately — do not wait for full batch
                        if on_fetched is not None:
                            await on_fetched(job_id, jd_text, title=title, company=company)

                        await asyncio.sleep(random.uniform(1.5, 3.0))

                    except Exception as e:
                        logger.warning("linkedin_jd_fetch_error",
                                       job_id=job_id, url=url, error=str(e))
                        results.append((job_id, ""))
                        if on_fetched is not None:
                            await on_fetched(job_id, "", title="", company="")

            finally:
                await context.close()
                await browser.close()

        return results
