"""TDD tests for LinkedInScraper — written before implementation."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "linkedin_search.html"


class TestLinkedInScraper:
    async def test_parses_job_cards_from_fixture_html(self):
        """Parses 3 job cards from fixture HTML using mocked Playwright page."""
        from agent.scrapers.linkedin import LinkedInScraper

        fixture_html = FIXTURE_PATH.read_text()

        with patch("agent.scrapers.linkedin.async_playwright") as mock_playwright_ctx:
            mock_page = AsyncMock()
            mock_page.content = AsyncMock(return_value=fixture_html)
            mock_page.goto = AsyncMock()
            mock_page.wait_for_selector = AsyncMock()
            mock_page.wait_for_timeout = AsyncMock()

            mock_browser = AsyncMock()
            mock_browser.new_page = AsyncMock(return_value=mock_page)
            mock_browser.close = AsyncMock()

            mock_pw = AsyncMock()
            mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_pw.__aenter__ = AsyncMock(return_value=mock_pw)
            mock_pw.__aexit__ = AsyncMock(return_value=None)
            mock_playwright_ctx.return_value = mock_pw

            scraper = LinkedInScraper()
            results = await scraper.scrape(["CAIO"], {})

        assert len(results) == 3
        assert results[0].title == "Chief AI Officer"
        assert results[0].source == "linkedin"
        assert "linkedin.com" in results[0].source_url

    async def test_returns_empty_list_on_429_response(self):
        """Returns [] when page indicates rate limiting (no job cards found)."""
        from agent.scrapers.linkedin import LinkedInScraper

        with patch("agent.scrapers.linkedin.async_playwright") as mock_playwright_ctx:
            mock_page = AsyncMock()
            mock_page.content = AsyncMock(return_value="<html><body><p>Too many requests</p></body></html>")
            mock_page.goto = AsyncMock()
            mock_page.wait_for_selector = AsyncMock(side_effect=Exception("Timeout"))
            mock_page.wait_for_timeout = AsyncMock()

            mock_browser = AsyncMock()
            mock_browser.new_page = AsyncMock(return_value=mock_page)
            mock_browser.close = AsyncMock()

            mock_pw = AsyncMock()
            mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_pw.__aenter__ = AsyncMock(return_value=mock_pw)
            mock_pw.__aexit__ = AsyncMock(return_value=None)
            mock_playwright_ctx.return_value = mock_pw

            scraper = LinkedInScraper()
            results = await scraper.scrape(["CAIO"], {})

        assert results == []

    async def test_source_field_is_linkedin(self):
        """All returned RawJob objects have source='linkedin'."""
        from agent.scrapers.linkedin import LinkedInScraper

        fixture_html = FIXTURE_PATH.read_text()

        with patch("agent.scrapers.linkedin.async_playwright") as mock_playwright_ctx:
            mock_page = AsyncMock()
            mock_page.content = AsyncMock(return_value=fixture_html)
            mock_page.goto = AsyncMock()
            mock_page.wait_for_selector = AsyncMock()
            mock_page.wait_for_timeout = AsyncMock()

            mock_browser = AsyncMock()
            mock_browser.new_page = AsyncMock(return_value=mock_page)
            mock_browser.close = AsyncMock()

            mock_pw = AsyncMock()
            mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_pw.__aenter__ = AsyncMock(return_value=mock_pw)
            mock_pw.__aexit__ = AsyncMock(return_value=None)
            mock_playwright_ctx.return_value = mock_pw

            scraper = LinkedInScraper()
            results = await scraper.scrape(["CAIO"], {})

        assert all(r.source == "linkedin" for r in results)
