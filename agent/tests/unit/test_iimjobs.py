"""TDD tests for IimjobsScraper — written before implementation."""
from pathlib import Path
from unittest.mock import patch, MagicMock


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "iimjobs_page.html"


class TestIimjobsScraper:
    async def test_extracts_all_job_cards(self):
        """Extracts all 3 job cards from fixture HTML."""
        from agent.scrapers.iimjobs import IimjobsScraper
        scraper = IimjobsScraper()

        with patch("agent.scrapers.iimjobs.requests.get") as mock_get:
            mock_response = MagicMock()
            mock_response.text = FIXTURE_PATH.read_text()
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            results = await scraper.scrape(["Head of AI"], {})

        assert len(results) == 3
        assert results[0].source == "iimjobs"
        assert "iimjobs.com" in results[0].source_url

    async def test_pagination_marker_detected(self):
        """Scraper detects the next-page marker in fixture."""
        from agent.scrapers.iimjobs import IimjobsScraper
        scraper = IimjobsScraper()

        html = FIXTURE_PATH.read_text()
        assert 'data-page="2"' in html  # sanity check fixture has pagination marker

    async def test_empty_page_returns_empty_list(self):
        """Returns [] when page has no job cards."""
        from agent.scrapers.iimjobs import IimjobsScraper
        scraper = IimjobsScraper()

        with patch("agent.scrapers.iimjobs.requests.get") as mock_get:
            mock_response = MagicMock()
            mock_response.text = "<html><body><p>No results</p></body></html>"
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            results = await scraper.scrape(["query"], {})

        assert results == []
