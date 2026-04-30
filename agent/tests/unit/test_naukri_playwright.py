"""TDD tests for Playwright-based NaukriScraper — written before implementation."""
from pathlib import Path
from unittest.mock import AsyncMock, patch


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "naukri_page.html"


def _make_playwright_mock(html: str):
    """Build a standard Playwright mock returning the given HTML."""
    mock_page = AsyncMock()
    mock_page.content = AsyncMock(return_value=html)
    mock_page.goto = AsyncMock()
    mock_page.wait_for_selector = AsyncMock()
    mock_page.wait_for_timeout = AsyncMock()
    mock_page.set_extra_http_headers = AsyncMock()

    mock_browser = AsyncMock()
    mock_browser.new_page = AsyncMock(return_value=mock_page)
    mock_browser.close = AsyncMock()

    mock_pw = AsyncMock()
    mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
    mock_pw.__aenter__ = AsyncMock(return_value=mock_pw)
    mock_pw.__aexit__ = AsyncMock(return_value=None)

    return mock_pw, mock_page


class TestNaukriPlaywrightScraper:
    async def test_parses_job_cards_from_fixture_html(self):
        """Parses 3 job cards from naukri_page.html fixture using mocked Playwright."""
        from agent.scrapers.naukri import NaukriScraper

        mock_pw, _ = _make_playwright_mock(FIXTURE_PATH.read_text())

        with patch("agent.scrapers.naukri.async_playwright") as ctx:
            ctx.return_value = mock_pw
            results = await NaukriScraper().scrape(["Head of AI"], {})

        assert len(results) == 3
        assert results[0].title == "Chief AI Officer"
        assert results[0].company == "Acme Corp"
        assert results[0].source == "naukri"
        assert "naukri.com" in results[0].source_url

    async def test_returns_empty_list_on_timeout(self):
        """Returns [] when wait_for_selector times out (bot detection or no results)."""
        from agent.scrapers.naukri import NaukriScraper

        mock_pw, mock_page = _make_playwright_mock("<html><body>Access denied</body></html>")
        mock_page.wait_for_selector = AsyncMock(side_effect=Exception("Timeout"))

        with patch("agent.scrapers.naukri.async_playwright") as ctx:
            ctx.return_value = mock_pw
            results = await NaukriScraper().scrape(["CAIO"], {})

        assert results == []

    async def test_source_field_is_naukri(self):
        """All returned RawJob objects have source='naukri'."""
        from agent.scrapers.naukri import NaukriScraper

        mock_pw, _ = _make_playwright_mock(FIXTURE_PATH.read_text())

        with patch("agent.scrapers.naukri.async_playwright") as ctx:
            ctx.return_value = mock_pw
            results = await NaukriScraper().scrape(["Head of AI"], {})

        assert all(r.source == "naukri" for r in results)

    async def test_skips_duplicate_urls(self):
        """Same URL appearing in multiple queries is only returned once."""
        from agent.scrapers.naukri import NaukriScraper

        mock_pw, _ = _make_playwright_mock(FIXTURE_PATH.read_text())

        with patch("agent.scrapers.naukri.async_playwright") as ctx:
            ctx.return_value = mock_pw
            # Two queries — both return same fixture HTML
            results = await NaukriScraper().scrape(["Head of AI", "Chief AI Officer"], {})

        urls = [r.source_url for r in results]
        assert len(urls) == len(set(urls)), "Duplicate URLs found"
