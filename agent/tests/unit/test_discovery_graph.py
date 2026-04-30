"""Integration test for the discovery graph with mocked scrapers and DB."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from agent.models import DiscoveryState, RawJob


FIXTURE_JOB = RawJob(
    title="Chief AI Officer",
    company="Acme Corp",
    jd_raw="Lead our AI transformation",
    source="naukri",
    source_url="https://naukri.com/job/j001",
)


def make_mock_pool():
    """Build an asyncpg pool mock that returns empty results."""
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=None)
    mock_conn.fetch = AsyncMock(return_value=[])
    mock_conn.execute = AsyncMock(return_value=None)
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)

    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=mock_conn)
    mock_pool.close = AsyncMock()
    return mock_pool


class TestDiscoveryGraph:
    async def test_graph_produces_deduplicated_jobs(self):
        """Full graph run with mocked scrapers yields correct job counts."""
        mock_pool = make_mock_pool()

        with (
            patch("agent.scrapers.naukri.NaukriScraper.scrape", new_callable=AsyncMock) as mock_naukri,
            patch("agent.scrapers.iimjobs.IimjobsScraper.scrape", new_callable=AsyncMock) as mock_iimjobs,
            patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool),
            patch("agent.db.bulk_insert_jobs", new_callable=AsyncMock, return_value=["id1", "id2"]) as mock_bulk,
            patch("agent.db.bulk_insert_scan_history", new_callable=AsyncMock) as mock_scan,
            patch("agent.db.update_pipeline_run", new_callable=AsyncMock) as mock_update_run,
            patch("agent.db.update_pipeline_job_status", new_callable=AsyncMock) as mock_update_job,
        ):
            mock_naukri.return_value = [
                FIXTURE_JOB,
                FIXTURE_JOB.model_copy(update={"source_url": "https://naukri.com/job/j002"}),
            ]
            mock_iimjobs.return_value = [
                FIXTURE_JOB.model_copy(update={"source": "iimjobs", "source_url": "https://iimjobs.com/j003"}),
            ]

            from agent.graphs.discovery import discovery_graph
            state = DiscoveryState(
                candidate_id="cand-1",
                pipeline_job_id="job-1",
                pipeline_run_id="run-1",
                preferences={"seniority_levels": ["CAIO"]},
            )
            result = await discovery_graph.ainvoke(state)

        # 3 jobs total (2 from naukri, 1 from iimjobs)
        assert len(result["deduplicated_jobs"]) == 3
