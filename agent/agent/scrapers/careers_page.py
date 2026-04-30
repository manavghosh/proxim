"""Careers page scraper — fetches jobs from custom company career URLs."""
from __future__ import annotations
import structlog
from playwright.async_api import async_playwright
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()


class CareersPageScraper(AbstractScraper):
    source_name = "careers_page"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:
        """Scrape jobs from all custom_job_sites (or target_companies_with_urls) in preferences."""
        target_companies: list = (
            preferences.get("custom_job_sites", [])
            or preferences.get("target_companies_with_urls", [])
        )

        all_jobs: list[RawJob] = []
        for entry in target_companies:
            if isinstance(entry, dict):
                url = entry.get("url", "")
                company = entry.get("company", url)
            else:
                url = str(entry)
                company = url
            if url:
                jobs = await self.scrape_url(url, company)
                all_jobs.extend(jobs)
        return all_jobs

    async def scrape_url(self, url: str, company: str) -> list[RawJob]:
        """Fetch a single careers page and extract job listings."""
        jobs: list[RawJob] = []
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(url, timeout=30_000)
                await page.wait_for_load_state("domcontentloaded")
                html = await page.content()
            finally:
                await browser.close()

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")

        for item in soup.select("li.position-item, .job-listing, .job-item, article.job"):
            title_tag = item.find(["h2", "h3", "h4", "a"])
            if not title_tag:
                continue
            title = title_tag.get_text(strip=True)
            if not title:
                continue

            from bs4 import Tag as BS4Tag
            from urllib.parse import urljoin
            link_tag = item.find("a", href=True)
            job_url = url
            if link_tag and isinstance(link_tag, BS4Tag):
                raw_href = link_tag.get("href", "")
                href = raw_href[0] if isinstance(raw_href, list) else (raw_href or "")
                if href:
                    job_url = href if href.startswith("http") else urljoin(url, href)

            location_tag = item.select_one(".location, [class*='location']")
            location = location_tag.get_text(strip=True) if location_tag else None

            jobs.append(RawJob(
                title=title,
                company=company,
                location=location,
                jd_raw=item.get_text(separator=" ", strip=True),
                source="careers_page",
                source_url=job_url,
            ))

        logger.info("careers_page_scrape_complete", url=url, jobs_found=len(jobs))
        return jobs
