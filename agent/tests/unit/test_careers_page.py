"""TDD tests for CareersPageScraper — written before implementation."""
from pathlib import Path
from unittest.mock import AsyncMock, patch


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "careers_page.html"
COMPANY_URL = "https://www.acmecorp.com/careers"


class TestCareersPageScraper:
    async def test_extracts_jobs_from_fixture_html(self):
        """Extracts 2 jobs from fixture HTML via mocked Playwright."""
        from agent.scrapers.careers_page import CareersPageScraper

        fixture_html = FIXTURE_PATH.read_text()

        with patch("agent.scrapers.careers_page.async_playwright") as mock_playwright_ctx:
            mock_page = AsyncMock()
            mock_page.content = AsyncMock(return_value=fixture_html)
            mock_page.goto = AsyncMock()
            mock_page.wait_for_load_state = AsyncMock()

            mock_browser = AsyncMock()
            mock_browser.new_page = AsyncMock(return_value=mock_page)
            mock_browser.close = AsyncMock()

            mock_pw = AsyncMock()
            mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_pw.__aenter__ = AsyncMock(return_value=mock_pw)
            mock_pw.__aexit__ = AsyncMock(return_value=None)
            mock_playwright_ctx.return_value = mock_pw

            scraper = CareersPageScraper()
            results = await scraper.scrape_url(COMPANY_URL, "Acme Corp")

        assert len(results) == 2
        assert results[0].title == "Chief AI Officer"
        assert results[0].source == "careers_page"
        assert results[0].company == "Acme Corp"

    async def test_returns_empty_list_when_no_jobs(self):
        """Returns [] when page has no job listings."""
        from agent.scrapers.careers_page import CareersPageScraper

        with patch("agent.scrapers.careers_page.async_playwright") as mock_playwright_ctx:
            mock_page = AsyncMock()
            mock_page.content = AsyncMock(return_value="<html><body><p>No openings</p></body></html>")
            mock_page.goto = AsyncMock()
            mock_page.wait_for_load_state = AsyncMock()

            mock_browser = AsyncMock()
            mock_browser.new_page = AsyncMock(return_value=mock_page)
            mock_browser.close = AsyncMock()

            mock_pw = AsyncMock()
            mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_pw.__aenter__ = AsyncMock(return_value=mock_pw)
            mock_pw.__aexit__ = AsyncMock(return_value=None)
            mock_playwright_ctx.return_value = mock_pw

            scraper = CareersPageScraper()
            results = await scraper.scrape_url(COMPANY_URL, "Acme Corp")

        assert results == []

    async def test_source_field_is_careers_page(self):
        """All returned RawJob objects have source='careers_page'."""
        from agent.scrapers.careers_page import CareersPageScraper

        fixture_html = FIXTURE_PATH.read_text()

        with patch("agent.scrapers.careers_page.async_playwright") as mock_playwright_ctx:
            mock_page = AsyncMock()
            mock_page.content = AsyncMock(return_value=fixture_html)
            mock_page.goto = AsyncMock()
            mock_page.wait_for_load_state = AsyncMock()

            mock_browser = AsyncMock()
            mock_browser.new_page = AsyncMock(return_value=mock_page)
            mock_browser.close = AsyncMock()

            mock_pw = AsyncMock()
            mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_pw.__aenter__ = AsyncMock(return_value=mock_pw)
            mock_pw.__aexit__ = AsyncMock(return_value=None)
            mock_playwright_ctx.return_value = mock_pw

            scraper = CareersPageScraper()
            results = await scraper.scrape_url(COMPANY_URL, "Acme Corp")

        assert all(r.source == "careers_page" for r in results)
