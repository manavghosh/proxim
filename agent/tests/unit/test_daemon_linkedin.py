"""Unit tests for LinkedIn daemon coroutines (F5) — acceptance polling + queued send loop."""
from __future__ import annotations

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch


def _days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


# ── Acceptance poll loop tests ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_acceptance_poll_loop_updates_accepted_status():
    pool = MagicMock()
    target = {
        "id": "tgt-1", "candidate_id": "cand-1",
        "linkedin_invitation_id": "inv-123",
        "sent_at": _days_ago(2),
    }

    with patch("agent.db.get_sent_outreach_targets_for_polling",
               new=AsyncMock(return_value=[target])), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"linkedin_access_token": "tok-abc"})), \
         patch("agent.db.update_outreach_target",
               new=AsyncMock()) as mock_update, \
         patch("agent.linkedin_api.get_invitation_status",
               new=AsyncMock(return_value="ACCEPTED")):

        from agent.daemon import _linkedin_acceptance_poll_once
        await _linkedin_acceptance_poll_once(pool)

    mock_update.assert_called_once()
    kwargs = mock_update.call_args[1]
    assert kwargs.get("status") == "accepted"
    assert kwargs.get("accepted_at") is not None


@pytest.mark.asyncio
async def test_acceptance_poll_loop_marks_expired_after_30_days():
    pool = MagicMock()
    target = {
        "id": "tgt-2", "candidate_id": "cand-1",
        "linkedin_invitation_id": "inv-456",
        "sent_at": _days_ago(31),
    }

    with patch("agent.db.get_sent_outreach_targets_for_polling",
               new=AsyncMock(return_value=[target])), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"linkedin_access_token": "tok-abc"})), \
         patch("agent.db.update_outreach_target",
               new=AsyncMock()) as mock_update, \
         patch("agent.linkedin_api.get_invitation_status",
               new=AsyncMock(return_value="PENDING")):

        from agent.daemon import _linkedin_acceptance_poll_once
        await _linkedin_acceptance_poll_once(pool)

    mock_update.assert_called_once()
    kwargs = mock_update.call_args[1]
    assert kwargs.get("status") == "expired"


# ── Queued send loop tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_queued_send_loop_sends_when_under_daily_limit():
    pool = MagicMock()
    target = {
        "id": "tgt-3", "candidate_id": "cand-1",
        "linkedin_url": "https://linkedin.com/in/alice",
        "note_a": "Hello Alice", "note_b": None,
        "selected_note": "A", "edited_note": None,
    }

    with patch("agent.db.get_queued_outreach_targets",
               new=AsyncMock(return_value=[target])), \
         patch("agent.db.get_daily_send_count",
               new=AsyncMock(return_value=5)), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"linkedin_access_token": "tok-abc", "linkedin_paused": False})), \
         patch("agent.db.update_outreach_target",
               new=AsyncMock()) as mock_update, \
         patch("agent.linkedin_api.send_connection_request",
               new=AsyncMock(return_value="inv-789")):

        from agent.daemon import _linkedin_queued_send_once
        await _linkedin_queued_send_once(pool)

    mock_update.assert_called_once()
    kwargs = mock_update.call_args[1]
    assert kwargs.get("status") == "sent"
    assert kwargs.get("linkedin_invitation_id") == "inv-789"


@pytest.mark.asyncio
async def test_queued_send_loop_skips_when_daily_limit_reached():
    pool = MagicMock()
    target = {
        "id": "tgt-4", "candidate_id": "cand-1",
        "linkedin_url": "https://linkedin.com/in/bob",
        "note_a": "Hi Bob", "note_b": None,
        "selected_note": "A", "edited_note": None,
    }

    with patch("agent.db.get_queued_outreach_targets",
               new=AsyncMock(return_value=[target])), \
         patch("agent.db.get_daily_send_count",
               new=AsyncMock(return_value=20)), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"linkedin_access_token": "tok-abc", "linkedin_paused": False})), \
         patch("agent.linkedin_api.send_connection_request",
               new=AsyncMock()) as mock_send:

        from agent.daemon import _linkedin_queued_send_once
        await _linkedin_queued_send_once(pool)

    mock_send.assert_not_called()


@pytest.mark.asyncio
async def test_queued_send_loop_skips_when_linkedin_paused():
    pool = MagicMock()
    target = {
        "id": "tgt-5", "candidate_id": "cand-1",
        "linkedin_url": "https://linkedin.com/in/carol",
        "note_a": "Hi Carol", "note_b": None,
        "selected_note": "A", "edited_note": None,
    }

    with patch("agent.db.get_queued_outreach_targets",
               new=AsyncMock(return_value=[target])), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"linkedin_access_token": "tok-abc", "linkedin_paused": True})), \
         patch("agent.linkedin_api.send_connection_request",
               new=AsyncMock()) as mock_send:

        from agent.daemon import _linkedin_queued_send_once
        await _linkedin_queued_send_once(pool)

    mock_send.assert_not_called()
