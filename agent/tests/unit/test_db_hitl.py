"""Tests for HITL snooze resurface DB functions."""
import pytest
import aiosqlite
from datetime import datetime, timezone, timedelta

from agent.db_sqlite import get_snoozed_jobs_to_resurface, resurface_snoozed_job


@pytest.fixture
async def db(tmp_path):
    """In-memory SQLite with hitl_checkpoints and jobs tables."""
    db_path = str(tmp_path / "test.db")
    conn = await aiosqlite.connect(db_path)
    await conn.execute("""
        CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
            candidate_id TEXT NOT NULL,
            pipeline_run_id TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            company TEXT NOT NULL DEFAULT '',
            jd_raw TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            source_url TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'discovered',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    await conn.execute("""
        CREATE TABLE hitl_checkpoints (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL UNIQUE,
            candidate_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'awaiting',
            decision_type TEXT,
            snoozed_until TEXT,
            decided_at TEXT,
            created_at TEXT NOT NULL
        )
    """)
    await conn.commit()
    yield conn
    await conn.close()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _past(seconds=60):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def _future(days=7):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


async def _insert_job(conn, job_id, status='scored'):
    now = _now()
    await conn.execute(
        "INSERT INTO jobs (id, candidate_id, title, company, jd_raw, source, source_url, status, created_at, updated_at) "
        "VALUES (?, 'cand-1', 'Test Job', 'Acme', 'JD', 'naukri', 'http://x.com', ?, ?, ?)",
        (job_id, status, now, now)
    )
    await conn.commit()


async def _insert_checkpoint(conn, cp_id, job_id, status, snoozed_until=None):
    await conn.execute(
        "INSERT INTO hitl_checkpoints (id, job_id, candidate_id, status, snoozed_until, created_at) "
        "VALUES (?, ?, 'cand-1', ?, ?, ?)",
        (cp_id, job_id, status, snoozed_until, _now())
    )
    await conn.commit()


@pytest.mark.asyncio
async def test_get_snoozed_jobs_returns_expired_snoozes(db):
    await _insert_job(db, 'job-1', 'snoozed')
    await _insert_checkpoint(db, 'cp-1', 'job-1', 'snoozed', _past(120))

    result = await get_snoozed_jobs_to_resurface(db)
    assert len(result) == 1
    assert result[0]['job_id'] == 'job-1'
    assert result[0]['checkpoint_id'] == 'cp-1'


@pytest.mark.asyncio
async def test_get_snoozed_jobs_excludes_future_snoozes(db):
    await _insert_job(db, 'job-2', 'snoozed')
    await _insert_checkpoint(db, 'cp-2', 'job-2', 'snoozed', _future(7))

    result = await get_snoozed_jobs_to_resurface(db)
    assert len(result) == 0


@pytest.mark.asyncio
async def test_resurface_snoozed_job_updates_status_to_awaiting(db):
    await _insert_job(db, 'job-3', 'snoozed')
    await _insert_checkpoint(db, 'cp-3', 'job-3', 'snoozed', _past(60))

    await resurface_snoozed_job(db, 'cp-3', 'job-3')

    async with db.execute("SELECT status FROM jobs WHERE id = 'job-3'") as cur:
        row = await cur.fetchone()
    assert row[0] == 'awaiting'


@pytest.mark.asyncio
async def test_resurface_clears_snoozed_until(db):
    await _insert_job(db, 'job-4', 'snoozed')
    await _insert_checkpoint(db, 'cp-4', 'job-4', 'snoozed', _past(60))

    await resurface_snoozed_job(db, 'cp-4', 'job-4')

    async with db.execute("SELECT status, snoozed_until FROM hitl_checkpoints WHERE id = 'cp-4'") as cur:
        row = await cur.fetchone()
    assert row[0] == 'awaiting'
    assert row[1] is None
