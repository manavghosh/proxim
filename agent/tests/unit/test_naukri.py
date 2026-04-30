"""TDD tests for NaukriScraper — written before implementation."""
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "naukri_response.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


class TestNaukriScraper:
    async def test_extracts_title_company_source_url(self):
        """Extracts correct fields from fixture response."""
        from agent.scrapers.naukri import NaukriScraper
        scraper = NaukriScraper()

        fixture = load_fixture()
        with patch("agent.scrapers.naukri.requests.get") as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = fixture
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            results = await scraper.scrape(["CAIO"], {})

        assert len(results) == 2  # 3rd record missing title, should be skipped
        assert results[0].title == "Chief AI Officer"
        assert results[0].company == "Acme Corp"
        assert "naukri.com" in results[0].source_url
        assert results[0].source == "naukri"

    async def test_skips_records_missing_title(self):
        """Records without a title field are silently dropped."""
        from agent.scrapers.naukri import NaukriScraper
        scraper = NaukriScraper()

        fixture = load_fixture()
        with patch("agent.scrapers.naukri.requests.get") as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = fixture
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            results = await scraper.scrape(["CAIO"], {})

        titles = [r.title for r in results]
        assert "BadData Inc" not in titles
        assert len(results) == 2

    async def test_returns_empty_list_on_empty_results(self):
        """Returns [] when jobDetails is empty."""
        from agent.scrapers.naukri import NaukriScraper
        scraper = NaukriScraper()

        with patch("agent.scrapers.naukri.requests.get") as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = {"noOfJobsDisplayed": 0, "jobDetails": []}
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            results = await scraper.scrape(["query"], {})

        assert results == []

    async def test_returns_rawjob_with_correct_source_field(self):
        """All returned jobs have source='naukri'."""
        from agent.scrapers.naukri import NaukriScraper
        scraper = NaukriScraper()

        fixture = load_fixture()
        with patch("agent.scrapers.naukri.requests.get") as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = fixture
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            results = await scraper.scrape(["CAIO"], {})

        assert all(r.source == "naukri" for r in results)
