"""Tests for the snooze resurface daemon coroutine."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_snooze_resurface_loop_calls_resurface_for_expired_items():
    """When an expired snooze exists, resurface_snoozed_job is called once."""
    mock_pool = MagicMock()
    expired = [{'checkpoint_id': 'cp-1', 'job_id': 'job-1'}]

    with patch('agent.db.get_snoozed_jobs_to_resurface', new=AsyncMock(return_value=expired)) as mock_get, \
         patch('agent.db.resurface_snoozed_job', new=AsyncMock()) as mock_resurface, \
         patch('asyncio.sleep', new=AsyncMock(side_effect=StopAsyncIteration)):

        from agent.daemon import _snooze_resurface_loop, _stop_event
        _stop_event.clear()

        try:
            await _snooze_resurface_loop(mock_pool)
        except StopAsyncIteration:
            pass

        mock_get.assert_called_once_with(mock_pool)
        mock_resurface.assert_called_once_with(mock_pool, 'cp-1', 'job-1')


@pytest.mark.asyncio
async def test_snooze_resurface_loop_does_nothing_when_no_expired():
    """When no expired snoozes exist, resurface_snoozed_job is NOT called."""
    mock_pool = MagicMock()

    with patch('agent.db.get_snoozed_jobs_to_resurface', new=AsyncMock(return_value=[])) as mock_get, \
         patch('agent.db.resurface_snoozed_job', new=AsyncMock()) as mock_resurface, \
         patch('asyncio.sleep', new=AsyncMock(side_effect=StopAsyncIteration)):

        from agent.daemon import _snooze_resurface_loop, _stop_event
        _stop_event.clear()

        try:
            await _snooze_resurface_loop(mock_pool)
        except StopAsyncIteration:
            pass

        mock_get.assert_called_once_with(mock_pool)
        mock_resurface.assert_not_called()
