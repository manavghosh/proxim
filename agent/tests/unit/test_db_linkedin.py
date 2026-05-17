"""Unit tests for LinkedIn Connector DB functions in db_sqlite.py (F5)."""
import json
import pytest
import aiosqlite
from datetime import datetime, timezone, timedelta

from agent.db_sqlite import (
    insert_outreach_target,
    update_outreach_target,
    get_queued_outreach_targets,
    get_sent_outreach_targets_for_polling,
    get_daily_send_count,
)

# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Test Candidate',
    preferences TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    job_type TEXT NOT NULL,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    pipeline_run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    jd_raw TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'naukri',
    source_url TEXT NOT NULL DEFAULT 'http://example.com',
    status TEXT NOT NULL DEFAULT 'approved',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outreach_targets (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    name TEXT,
    linkedin_url TEXT,
    title TEXT,
    company TEXT NOT NULL,
    seniority TEXT,
    enrichment_json TEXT,
    note_a TEXT,
    note_b TEXT,
    selected_note TEXT,
    edited_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    sent_at TEXT,
    accepted_at TEXT,
    last_polled_at TEXT,
    linkedin_invitation_id TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CAND_ID = "cand-0000-0000-0000-000000000001"
JOB_ID  = "job--0000-0000-0000-000000000001"
RUN_ID  = "run--0000-0000-0000-000000000001"
PJ_ID   = "pjob-0000-0000-0000-000000000001"


@pytest.fixture
async def db():
    """In-memory SQLite with full schema + seed rows."""
    conn = await aiosqlite.connect(":memory:")
    await conn.executescript(SCHEMA_SQL)
    await conn.execute("INSERT INTO candidates (id) VALUES (?)", (CAND_ID,))
    await conn.execute(
        "INSERT INTO pipeline_jobs (id, job_type, candidate_id) VALUES (?, 'linkedin_connector', ?)",
        (PJ_ID, CAND_ID),
    )
    await conn.execute(
        "INSERT INTO pipeline_runs (id, pipeline_job_id, candidate_id) VALUES (?, ?, ?)",
        (RUN_ID, PJ_ID, CAND_ID),
    )
    await conn.execute(
        "INSERT INTO jobs (id, candidate_id, pipeline_run_id, title, company) "
        "VALUES (?, ?, ?, 'Head of AI', 'Acme Corp')",
        (JOB_ID, CAND_ID, RUN_ID),
    )
    await conn.commit()
    yield conn
    await conn.close()


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_insert_outreach_target_creates_pending_row(db):
    target_id = await insert_outreach_target(db, JOB_ID, CAND_ID, "Acme Corp")

    assert target_id, "should return a non-empty id"

    async with db.execute(
        "SELECT status, job_id, candidate_id, company FROM outreach_targets WHERE id = ?",
        (target_id,),
    ) as cur:
        row = await cur.fetchone()

    assert row is not None, "row should exist"
    assert row[0] == "pending"
    assert row[1] == JOB_ID
    assert row[2] == CAND_ID
    assert row[3] == "Acme Corp"


@pytest.mark.asyncio
async def test_update_outreach_target_sets_status(db):
    target_id = await insert_outreach_target(db, JOB_ID, CAND_ID, "Acme Corp")

    await update_outreach_target(db, target_id, status="notes_ready", note_a="Hello", note_b="Hi there")

    async with db.execute(
        "SELECT status, note_a, note_b FROM outreach_targets WHERE id = ?",
        (target_id,),
    ) as cur:
        row = await cur.fetchone()

    assert row[0] == "notes_ready"
    assert row[1] == "Hello"
    assert row[2] == "Hi there"


@pytest.mark.asyncio
async def test_get_daily_send_count_returns_zero_when_no_sends(db):
    count = await get_daily_send_count(db, CAND_ID)
    assert count == 0


@pytest.mark.asyncio
async def test_get_daily_send_count_returns_correct_count_for_today(db):
    # Insert target, mark as sent with today's timestamp
    target_id = await insert_outreach_target(db, JOB_ID, CAND_ID, "Acme Corp")
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    await update_outreach_target(db, target_id, status="sent", sent_at=today_iso)

    count = await get_daily_send_count(db, CAND_ID)
    assert count == 1


@pytest.mark.asyncio
async def test_get_queued_outreach_targets_returns_only_queued(db):
    # Create two targets — one queued, one pending
    target_queued  = await insert_outreach_target(db, JOB_ID, CAND_ID, "Acme Corp")
    await update_outreach_target(db, target_queued, status="queued")

    # Insert a second job + target with pending status (should not appear)
    job2 = "job--0000-0000-0000-000000000002"
    await db.execute(
        "INSERT INTO jobs (id, candidate_id, pipeline_run_id, title, company) "
        "VALUES (?, ?, ?, 'AI Lead', 'Beta Ltd')",
        (job2, CAND_ID, RUN_ID),
    )
    await db.commit()
    await insert_outreach_target(db, job2, CAND_ID, "Beta Ltd")  # stays 'pending'

    queued = await get_queued_outreach_targets(db, CAND_ID)

    assert len(queued) == 1
    assert queued[0]["id"] == target_queued
    assert queued[0]["company"] == "Acme Corp"
