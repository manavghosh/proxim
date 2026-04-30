"""TDD tests for insert_pipeline_log — written before implementation."""
from unittest.mock import AsyncMock, MagicMock


class TestInsertPipelineLog:
    async def test_inserts_log_row(self, mock_connection):
        """insert_pipeline_log executes an INSERT with correct arguments."""
        mock_connection.execute = AsyncMock()
        mock_pool = MagicMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_connection)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        from agent.db import insert_pipeline_log
        await insert_pipeline_log(
            mock_pool,
            pipeline_job_id="job-1",
            level="info",
            step="scrape_naukri",
            message="Naukri complete — 5 jobs found",
            data={"jobs_found": 5},
        )

        mock_connection.execute.assert_called_once()
        call_sql = mock_connection.execute.call_args[0][0]
        assert "INSERT INTO pipeline_logs" in call_sql

    async def test_works_without_data(self, mock_connection):
        """insert_pipeline_log accepts None for data."""
        mock_connection.execute = AsyncMock()
        mock_pool = MagicMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_connection)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        from agent.db import insert_pipeline_log
        await insert_pipeline_log(
            mock_pool,
            pipeline_job_id="job-1",
            level="info",
            step="build_queries",
            message="Generated 7 queries",
        )

        mock_connection.execute.assert_called_once()
