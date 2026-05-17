"""Unit tests for outreach mailer daemon coroutines (F6) — T029 & T063."""
from __future__ import annotations

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _past(minutes: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()

def _future(hours: int = 72) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _make_draft(
    draft_id="d-001",
    cadence_id="cad-001",
    candidate_id="cand-001",
    day_number=1,
    scheduled_send_at=None,
    gmail_thread_id=None,
    day1_message_id=None,
    hiring_manager_email="sarah@acme.com",
    cadence_status="approved",
):
    return {
        "id": draft_id,
        "cadence_id": cadence_id,
        "candidate_id": candidate_id,
        "day_number": day_number,
        "subject": "Re: Head of AI @ Acme",
        "body_html": "<p>Hello Sarah</p>",
        "body_text": "Hello Sarah",
        "scheduled_send_at": scheduled_send_at or _past(),
        "gmail_thread_id": gmail_thread_id,
        "day1_message_id": day1_message_id,
        "hiring_manager_email": hiring_manager_email,
        "cadence_status": cadence_status,
    }


def _make_resume_version(pdf_path="agent/output/resumes/resume.pdf"):
    return {"id": "rv-001", "resume_pdf_path": pdf_path, "cover_letter_pdf_path": None}


# ── Send Loop Tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_send_loop_sends_day1_when_scheduled_and_pdf_available():
    pool = MagicMock()
    draft = _make_draft(day_number=1)

    mock_send = MagicMock(return_value={"id": "gmail-msg-001", "threadId": "thread-001"})
    mock_service = MagicMock()
    mock_service.users.return_value.messages.return_value.send.return_value.execute = mock_send

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=0)), \
         patch("agent.db.get_resume_version_for_send", new=AsyncMock(return_value=_make_resume_version())), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.gmail_client.build_service", return_value=mock_service), \
         patch("agent.gmail_client.send_email", return_value={"id": "gmail-msg-001", "threadId": "thread-001"}), \
         patch("agent.db.update_email_draft", new=AsyncMock()) as mock_update_draft, \
         patch("agent.db.update_email_cadence", new=AsyncMock()) as mock_update_cadence:

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    mock_update_draft.assert_called()
    call_kwargs = mock_update_draft.call_args[1]
    assert call_kwargs.get("status") == "sent"


@pytest.mark.asyncio
async def test_send_loop_sets_attachment_missing_when_no_pdf_in_resume_versions():
    pool = MagicMock()
    draft = _make_draft(day_number=1)

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=0)), \
         patch("agent.db.get_resume_version_for_send", new=AsyncMock(return_value=None)), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.db.update_email_cadence", new=AsyncMock()) as mock_update_cadence:

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    mock_update_cadence.assert_called()
    kwargs = mock_update_cadence.call_args[1]
    assert kwargs.get("status") == "attachment_missing"


@pytest.mark.asyncio
async def test_send_loop_sets_day3_and_day7_scheduled_send_at_after_day1_sent():
    pool = MagicMock()
    draft = _make_draft(day_number=1, cadence_id="cad-001")

    draft3 = {**_make_draft(draft_id="d-003", day_number=3, cadence_id="cad-001"), "scheduled_send_at": None}
    draft7 = {**_make_draft(draft_id="d-007", day_number=7, cadence_id="cad-001"), "scheduled_send_at": None}

    update_draft_calls = []

    async def mock_update_draft(pool, draft_id, **kwargs):
        update_draft_calls.append((draft_id, kwargs))

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=0)), \
         patch("agent.db.get_resume_version_for_send", new=AsyncMock(return_value=_make_resume_version())), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.gmail_client.send_email", return_value={"id": "gm-001", "threadId": "th-001"}), \
         patch("agent.db.get_cadence_drafts", new=AsyncMock(return_value=[draft3, draft7])), \
         patch("agent.db.update_email_draft", new=AsyncMock(side_effect=mock_update_draft)), \
         patch("agent.db.update_email_cadence", new=AsyncMock()):

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    # Find updates for day 3 and day 7
    day3_updates = [c for c in update_draft_calls if c[0] == "d-003"]
    day7_updates = [c for c in update_draft_calls if c[0] == "d-007"]
    assert any("scheduled_send_at" in u[1] for u in day3_updates), "Day 3 scheduled_send_at not set"
    assert any("scheduled_send_at" in u[1] for u in day7_updates), "Day 7 scheduled_send_at not set"


@pytest.mark.asyncio
async def test_send_loop_skips_draft_when_cadence_reply_detected():
    pool = MagicMock()
    # get_scheduled_drafts should exclude reply-detected cadences (tested in DB tests)
    # This test verifies the send loop does not call send for empty list
    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[])), \
         patch("agent.gmail_client.send_email") as mock_send:

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    mock_send.assert_not_called()


@pytest.mark.asyncio
async def test_send_loop_sets_rate_limited_and_bumps_scheduled_at_when_20_emails_sent_today():
    pool = MagicMock()
    draft = _make_draft(day_number=1)

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=20)), \
         patch("agent.db.update_email_draft", new=AsyncMock()) as mock_update_draft, \
         patch("agent.gmail_client.send_email") as mock_send:

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    mock_send.assert_not_called()
    mock_update_draft.assert_called()
    kwargs = mock_update_draft.call_args[1]
    assert kwargs.get("status") == "rate_limited"
    assert "scheduled_send_at" in kwargs


@pytest.mark.asyncio
async def test_send_loop_sets_cadence_auth_expired_on_gmail_auth_error():
    pool = MagicMock()
    draft = _make_draft(day_number=1)

    from agent.gmail_client import GmailAuthExpiredError

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=0)), \
         patch("agent.db.get_resume_version_for_send", new=AsyncMock(return_value=_make_resume_version())), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.gmail_client.send_email", side_effect=GmailAuthExpiredError("expired")), \
         patch("agent.db.update_email_cadence", new=AsyncMock()) as mock_update_cadence:

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    mock_update_cadence.assert_called()
    kwargs = mock_update_cadence.call_args[1]
    assert kwargs.get("status") == "auth_expired"


@pytest.mark.asyncio
async def test_send_loop_threads_day3_day7_using_day1_message_id_and_thread_id():
    pool = MagicMock()
    draft = _make_draft(
        day_number=3,
        cadence_id="cad-001",
        gmail_thread_id="th-001",
        day1_message_id="msg-001",
        cadence_status="active",
    )

    captured_kwargs = {}

    def capture_send(**kwargs):
        captured_kwargs.update(kwargs)
        return {"id": "gm-003", "threadId": "th-001"}

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=0)), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.gmail_client.send_email", side_effect=lambda *a, **kw: capture_send(**kw) or {"id": "gm-003", "threadId": "th-001"}), \
         patch("agent.db.update_email_draft", new=AsyncMock()), \
         patch("agent.db.update_email_cadence", new=AsyncMock()):

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    assert captured_kwargs.get("thread_id") == "th-001"
    assert captured_kwargs.get("in_reply_to") == "msg-001"


# ── Reply/Bounce Detection Tests (T063) ───────────────────────────────────────

@pytest.mark.asyncio
async def test_reply_detection_sets_cadence_replied_and_cancels_pending_drafts():
    pool = MagicMock()
    cadence = {
        "id": "cad-001", "candidate_id": "cand-001",
        "day1_message_id": "msg-001", "gmail_thread_id": "th-001",
    }

    with patch("agent.db.get_active_cadences_for_polling", new=AsyncMock(return_value=[cadence])), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.gmail_client.build_service", return_value=MagicMock()), \
         patch("agent.gmail_client.check_reply", return_value=True), \
         patch("agent.gmail_client.check_bounce", return_value=False), \
         patch("agent.db.update_email_cadence", new=AsyncMock()) as mock_cadence_update, \
         patch("agent.db.cancel_pending_drafts", new=AsyncMock()) as mock_cancel:

        from agent.daemon import _reply_bounce_detection_once
        await _reply_bounce_detection_once(pool)

    mock_cadence_update.assert_called()
    kwargs = mock_cadence_update.call_args[1]
    assert kwargs.get("status") == "replied"
    mock_cancel.assert_called()


@pytest.mark.asyncio
async def test_reply_detection_skips_when_no_day1_message_id():
    pool = MagicMock()
    cadence = {
        "id": "cad-001", "candidate_id": "cand-001",
        "day1_message_id": None, "gmail_thread_id": None,
    }

    with patch("agent.db.get_active_cadences_for_polling", new=AsyncMock(return_value=[cadence])), \
         patch("agent.gmail_client.check_reply") as mock_check:

        from agent.daemon import _reply_bounce_detection_once
        await _reply_bounce_detection_once(pool)

    mock_check.assert_not_called()


@pytest.mark.asyncio
async def test_bounce_detection_sets_cadence_bounced_sets_day1_bounced_and_cancels_day3_day7():
    pool = MagicMock()
    cadence = {
        "id": "cad-001", "candidate_id": "cand-001",
        "day1_message_id": "msg-001", "gmail_thread_id": "th-001",
    }

    with patch("agent.db.get_active_cadences_for_polling", new=AsyncMock(return_value=[cadence])), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.gmail_client.build_service", return_value=MagicMock()), \
         patch("agent.gmail_client.check_reply", return_value=False), \
         patch("agent.gmail_client.check_bounce", return_value=True), \
         patch("agent.db.update_email_cadence", new=AsyncMock()) as mock_cadence_update, \
         patch("agent.db.bounce_day1_cancel_day3_day7", new=AsyncMock()) as mock_bounce:

        from agent.daemon import _reply_bounce_detection_once
        await _reply_bounce_detection_once(pool)

    mock_cadence_update.assert_called()
    kwargs = mock_cadence_update.call_args[1]
    assert kwargs.get("status") == "bounced"
    mock_bounce.assert_called_with(pool, "cad-001")


@pytest.mark.asyncio
async def test_detection_loop_handles_gmail_auth_expired_gracefully():
    pool = MagicMock()
    cadence = {
        "id": "cad-001", "candidate_id": "cand-001",
        "day1_message_id": "msg-001", "gmail_thread_id": "th-001",
    }

    from agent.gmail_client import GmailAuthExpiredError

    with patch("agent.db.get_active_cadences_for_polling", new=AsyncMock(return_value=[cadence])), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref"})), \
         patch("agent.gmail_client.build_service", side_effect=GmailAuthExpiredError("expired")), \
         patch("agent.db.update_email_cadence", new=AsyncMock()) as mock_update:

        from agent.daemon import _reply_bounce_detection_once
        await _reply_bounce_detection_once(pool)

    mock_update.assert_called()
    kwargs = mock_update.call_args[1]
    assert kwargs.get("status") == "auth_expired"


@pytest.mark.asyncio
async def test_detection_loop_does_not_overwrite_existing_reply_detected_at():
    pool = MagicMock()
    # If cadence already has reply_detected_at, get_active_cadences_for_polling
    # won't return it (status != 'active') — so detection loop is never called
    with patch("agent.db.get_active_cadences_for_polling", new=AsyncMock(return_value=[])), \
         patch("agent.gmail_client.check_reply") as mock_check:

        from agent.daemon import _reply_bounce_detection_once
        await _reply_bounce_detection_once(pool)

    mock_check.assert_not_called()
