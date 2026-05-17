"""Unit tests for email cadence DB functions (F6) — T022."""
from __future__ import annotations

import pytest
import aiosqlite
from datetime import datetime, timezone, timedelta

from agent.db_sqlite import (
    insert_email_cadence,
    update_email_cadence,
    insert_email_drafts,
    get_scheduled_drafts,
    get_active_cadences_for_polling,
    get_daily_email_send_count,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Test',
    parse_status TEXT NOT NULL DEFAULT 'pending',
    preferences TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    pipeline_job_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    sources_attempted INTEGER NOT NULL DEFAULT 0,
    sources_successful INTEGER NOT NULL DEFAULT 0,
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_deduplicated INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    job_type TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    pipeline_run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    jd_raw TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'test',
    source_url TEXT NOT NULL DEFAULT 'http://test',
    status TEXT NOT NULL DEFAULT 'discovered',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_cadences (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    hiring_manager_email TEXT,
    email_confidence INTEGER,
    email_source TEXT,
    gmail_thread_id TEXT,
    day1_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending_discovery',
    approved_at TEXT,
    reply_detected_at TEXT,
    bounce_detected_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_drafts (
    id TEXT PRIMARY KEY,
    cadence_id TEXT NOT NULL REFERENCES email_cadences(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    day_number INTEGER NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT NOT NULL,
    original_body_html TEXT NOT NULL,
    is_approved INTEGER NOT NULL DEFAULT 0,
    scheduled_send_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    sent_at TEXT,
    gmail_message_id TEXT,
    open_detected_at TEXT,
    click_detected_at TEXT,
    bounce_detected_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CANDIDATE_ID = "cand-001"
JOB_ID = "job-001"
RUN_ID = "run-001"
PJ_ID = "pj-001"


@pytest.fixture
async def db():
    async with aiosqlite.connect(":memory:") as conn:
        await conn.executescript(SCHEMA)
        await conn.execute(
            "INSERT INTO candidates (id, name, parse_status, preferences) VALUES (?,?,?,?)",
            (CANDIDATE_ID, "Test Candidate", "ready", "{}"),
        )
        await conn.execute(
            "INSERT INTO pipeline_jobs (id, status, job_type, candidate_id) VALUES (?,?,?,?)",
            (PJ_ID, "queued", "discovery", CANDIDATE_ID),
        )
        await conn.execute(
            "INSERT INTO pipeline_runs (id, pipeline_job_id, candidate_id) VALUES (?,?,?)",
            (RUN_ID, PJ_ID, CANDIDATE_ID),
        )
        await conn.execute(
            "INSERT INTO jobs (id, candidate_id, pipeline_run_id, title, company) VALUES (?,?,?,?,?)",
            (JOB_ID, CANDIDATE_ID, RUN_ID, "Head of AI", "Acme"),
        )
        await conn.commit()
        yield conn


@pytest.mark.asyncio
async def test_insert_email_cadence_creates_pending_discovery_row(db):
    cadence_id = await insert_email_cadence(db, JOB_ID, CANDIDATE_ID)
    assert cadence_id is not None

    async with db.execute(
        "SELECT status FROM email_cadences WHERE id = ?", (cadence_id,)
    ) as cur:
        row = await cur.fetchone()
    assert row is not None
    assert row[0] == "pending_discovery"


@pytest.mark.asyncio
async def test_update_email_cadence_sets_status(db):
    cadence_id = await insert_email_cadence(db, JOB_ID, CANDIDATE_ID)
    await update_email_cadence(db, cadence_id, status="discovering")

    async with db.execute(
        "SELECT status FROM email_cadences WHERE id = ?", (cadence_id,)
    ) as cur:
        row = await cur.fetchone()
    assert row[0] == "discovering"


@pytest.mark.asyncio
async def test_insert_email_drafts_creates_three_rows_with_correct_day_numbers(db):
    cadence_id = await insert_email_cadence(db, JOB_ID, CANDIDATE_ID)
    drafts = [
        {"day_number": 1, "subject": "Hi", "body_html": "<p>D1</p>", "body_text": "D1", "original_body_html": "<p>D1</p>"},
        {"day_number": 3, "subject": "Hi", "body_html": "<p>D3</p>", "body_text": "D3", "original_body_html": "<p>D3</p>"},
        {"day_number": 7, "subject": "Hi", "body_html": "<p>D7</p>", "body_text": "D7", "original_body_html": "<p>D7</p>"},
    ]
    await insert_email_drafts(db, cadence_id, CANDIDATE_ID, drafts)

    async with db.execute(
        "SELECT day_number FROM email_drafts WHERE cadence_id = ? ORDER BY day_number", (cadence_id,)
    ) as cur:
        rows = await cur.fetchall()
    assert [r[0] for r in rows] == [1, 3, 7]


@pytest.mark.asyncio
async def test_get_daily_email_send_count_returns_zero_when_no_sends(db):
    count = await get_daily_email_send_count(db, CANDIDATE_ID)
    assert count == 0


@pytest.mark.asyncio
async def test_get_daily_email_send_count_counts_todays_sends_only(db):
    cadence_id = await insert_email_cadence(db, JOB_ID, CANDIDATE_ID)
    drafts = [
        {"day_number": 1, "subject": "Hi", "body_html": "<p>D1</p>", "body_text": "D1", "original_body_html": "<p>D1</p>"},
    ]
    await insert_email_drafts(db, cadence_id, CANDIDATE_ID, drafts)

    # Mark draft as sent today
    async with db.execute("SELECT id FROM email_drafts WHERE cadence_id = ?", (cadence_id,)) as cur:
        draft_id = (await cur.fetchone())[0]
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE email_drafts SET status = 'sent', sent_at = ? WHERE id = ?",
        (now, draft_id),
    )
    # Insert a yesterday sent draft - should not count
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    await db.execute(
        "INSERT INTO email_drafts (id, cadence_id, candidate_id, day_number, subject, body_html, body_text, original_body_html, status, sent_at) "
        "VALUES ('d-old', ?, ?, 3, 'Hi', '<p/>', '', '<p/>', 'sent', ?)",
        (cadence_id, CANDIDATE_ID, yesterday),
    )
    await db.commit()

    count = await get_daily_email_send_count(db, CANDIDATE_ID)
    assert count == 1


@pytest.mark.asyncio
async def test_get_scheduled_drafts_returns_only_elapsed_scheduled_at(db):
    cadence_id = await insert_email_cadence(db, JOB_ID, CANDIDATE_ID)
    await update_email_cadence(db, cadence_id, status="approved")

    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()

    await db.execute(
        "INSERT INTO email_drafts (id, cadence_id, candidate_id, day_number, subject, body_html, body_text, original_body_html, status, scheduled_send_at) "
        "VALUES ('d1', ?, ?, 1, 'Hi', '<p/>', '', '<p/>', 'scheduled', ?)",
        (cadence_id, CANDIDATE_ID, past),
    )
    await db.execute(
        "INSERT INTO email_drafts (id, cadence_id, candidate_id, day_number, subject, body_html, body_text, original_body_html, status, scheduled_send_at) "
        "VALUES ('d3', ?, ?, 3, 'Hi', '<p/>', '', '<p/>', 'scheduled', ?)",
        (cadence_id, CANDIDATE_ID, future),
    )
    await db.commit()

    drafts = await get_scheduled_drafts(db)
    assert len(drafts) == 1
    assert drafts[0]["day_number"] == 1


@pytest.mark.asyncio
async def test_get_scheduled_drafts_excludes_drafts_when_reply_detected(db):
    cadence_id = await insert_email_cadence(db, JOB_ID, CANDIDATE_ID)
    now = datetime.now(timezone.utc).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    await update_email_cadence(db, cadence_id, status="active", reply_detected_at=now)

    await db.execute(
        "INSERT INTO email_drafts (id, cadence_id, candidate_id, day_number, subject, body_html, body_text, original_body_html, status, scheduled_send_at) "
        "VALUES ('d3', ?, ?, 3, 'Hi', '<p/>', '', '<p/>', 'scheduled', ?)",
        (cadence_id, CANDIDATE_ID, past),
    )
    await db.commit()

    drafts = await get_scheduled_drafts(db)
    assert len(drafts) == 0


@pytest.mark.asyncio
async def test_get_active_cadences_for_polling_returns_only_active_with_message_id(db):
    cid1 = await insert_email_cadence(db, JOB_ID, CANDIDATE_ID)
    await update_email_cadence(db, cid1, status="active", day1_message_id="msg-111")

    # Second job for a second cadence
    job2_id = "job-002"
    await db.execute(
        "INSERT INTO jobs (id, candidate_id, pipeline_run_id, title, company) VALUES (?,?,?,?,?)",
        (job2_id, CANDIDATE_ID, RUN_ID, "CTO", "Beta"),
    )
    await db.commit()
    cid2 = await insert_email_cadence(db, job2_id, CANDIDATE_ID)
    # cid2 is pending_discovery with no day1_message_id

    cadences = await get_active_cadences_for_polling(db)
    assert len(cadences) == 1
    assert cadences[0]["id"] == cid1
    assert cadences[0]["day1_message_id"] == "msg-111"
