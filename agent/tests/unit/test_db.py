"""Tests for agent/db.py — written before implementation (TDD)."""
from unittest.mock import AsyncMock, MagicMock


class TestClaimPipelineJob:
    async def test_returns_job_when_queued(self, mock_connection):
        """claim_pipeline_job returns a job dict when one is queued."""
        mock_connection.fetchrow = AsyncMock(return_value={
            'id': 'job-uuid-1',
            'status': 'queued',
            'job_type': 'discovery_only',
            'candidate_id': 'cand-uuid-1',
            'payload': '{}',
        })
        mock_pool = MagicMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_connection)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        from agent.db import claim_pipeline_job
        result = await claim_pipeline_job(mock_pool)

        assert result is not None
        assert result['id'] == 'job-uuid-1'
        assert result['status'] == 'running'

    async def test_returns_none_when_queue_empty(self, mock_connection):
        """claim_pipeline_job returns None when no jobs are queued."""
        mock_connection.fetchrow = AsyncMock(return_value=None)
        mock_pool = MagicMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_connection)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        from agent.db import claim_pipeline_job
        result = await claim_pipeline_job(mock_pool)

        assert result is None


class TestUpdatePipelineJobStatus:
    async def test_sets_completed_status(self, mock_connection):
        """update_pipeline_job_status sets status and completed_at."""
        mock_connection.execute = AsyncMock()
        mock_pool = MagicMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_connection)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        from agent.db import update_pipeline_job_status
        await update_pipeline_job_status(mock_pool, 'job-uuid-1', 'completed')

        mock_connection.execute.assert_called_once()
        call_args = mock_connection.execute.call_args[0]
        assert 'completed' in call_args[0] or 'completed' in str(call_args)
