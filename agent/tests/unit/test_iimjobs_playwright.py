"""TDD tests for Playwright-based IimjobsScraper — written before implementation."""
from pathlib import Path
from unittest.mock import AsyncMock, patch


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "iimjobs_search.html"


def _make_playwright_mock(html: str):
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


class TestIimjobsPlaywrightScraper:
    async def test_parses_job_cards_from_fixture_html(self):
        """Parses 3 job cards from iimjobs_search.html fixture."""
        from agent.scrapers.iimjobs import IimjobsScraper

        mock_pw, _ = _make_playwright_mock(FIXTURE_PATH.read_text())

        with patch("agent.scrapers.iimjobs.async_playwright") as ctx:
            ctx.return_value = mock_pw
            results = await IimjobsScraper().scrape(["Head of AI"], {})

        assert len(results) == 3
        assert results[0].source == "iimjobs"
        assert "iimjobs.com" in results[0].source_url

    async def test_returns_empty_list_on_timeout(self):
        """Returns [] when page times out or has no results."""
        from agent.scrapers.iimjobs import IimjobsScraper

        mock_pw, mock_page = _make_playwright_mock("<html><body>No results</body></html>")
        mock_page.wait_for_selector = AsyncMock(side_effect=Exception("Timeout"))

        with patch("agent.scrapers.iimjobs.async_playwright") as ctx:
            ctx.return_value = mock_pw
            results = await IimjobsScraper().scrape(["CAIO"], {})

        assert results == []

    async def test_source_field_is_iimjobs(self):
        """All returned RawJob objects have source='iimjobs'."""
        from agent.scrapers.iimjobs import IimjobsScraper

        mock_pw, _ = _make_playwright_mock(FIXTURE_PATH.read_text())

        with patch("agent.scrapers.iimjobs.async_playwright") as ctx:
            ctx.return_value = mock_pw
            results = await IimjobsScraper().scrape(["Head of AI"], {})

        assert all(r.source == "iimjobs" for r in results)
