"""LinkedIn JD scraper — visits individual job detail pages to extract full descriptions."""
import asyncio
import random
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
]


class LinkedInJdScraper:
    """Fetches job description text from LinkedIn job detail pages.

    Does NOT extend AbstractScraper — has a different interface:
    takes {id, source_url} dicts, returns (job_id, jd_text) tuples.
    """

    async def fetch_jds(self, jobs: list[dict]) -> list[tuple[str, str]]:
        """
        Visit each job's LinkedIn detail page and extract the JD text.

        Returns a list of (job_id, jd_text) tuples. jd_text is '' for
        any page that fails — those jobs will be retried on the next run.
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

                        results.append((job_id, jd_text))
                        logger.debug("linkedin_jd_fetched",
                                     job_id=job_id, words=len(jd_text.split()))
                        await asyncio.sleep(random.uniform(1.5, 3.0))

                    except Exception as e:
                        logger.warning("linkedin_jd_fetch_error",
                                       job_id=job_id, url=url, error=str(e))
                        results.append((job_id, ""))

            finally:
                await context.close()
                await browser.close()

        return results
