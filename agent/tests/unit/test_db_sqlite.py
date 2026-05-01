"""Unit tests for db_sqlite.py using an in-memory SQLite database."""
import json
import pytest
import aiosqlite

from agent.db_sqlite import (
    claim_pipeline_job,
    update_pipeline_job_status,
    insert_pipeline_run,
    update_pipeline_run,
    get_scan_history_urls,
    bulk_insert_jobs,
    bulk_insert_scan_history,
    insert_pipeline_log,
    get_candidate_preferences,
)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    candidate_id TEXT,
    base_cv_md TEXT,
    base_cv_hash TEXT,
    parsed_profile TEXT,
    parse_status TEXT NOT NULL DEFAULT 'pending',
    preferences TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    job_type TEXT NOT NULL,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    pipeline_job_id TEXT NOT NULL REFERENCES pipeline_jobs(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    status TEXT NOT NULL DEFAULT 'running',
    sources_attempted INTEGER NOT NULL DEFAULT 0,
    sources_successful INTEGER NOT NULL DEFAULT 0,
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_deduplicated INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    summary TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    jd_raw TEXT NOT NULL,
    jd_text TEXT,
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    application_url TEXT,
    posted_at TEXT,
    status TEXT NOT NULL DEFAULT 'discovered',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scan_history (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    url TEXT NOT NULL,
    job_id TEXT REFERENCES jobs(id),
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (candidate_id, url)
);
CREATE TABLE IF NOT EXISTS pipeline_logs (
    id TEXT PRIMARY KEY,
    pipeline_job_id TEXT NOT NULL REFERENCES pipeline_jobs(id),
    level TEXT NOT NULL,
    step TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CANDIDATE_ID = "00000000-0000-0000-0000-000000000001"
JOB_ID_FIXTURE = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
async def conn():
    """In-memory SQLite connection with full schema applied."""
    db = await aiosqlite.connect(":memory:")
    await db.executescript(SCHEMA_SQL)
    await db.execute(
        "INSERT INTO candidates (id, preferences) VALUES (?, ?)",
        (CANDIDATE_ID, json.dumps({"enabled_sources": ["linkedin"]})),
    )
    await db.commit()
    yield db
    await db.close()


@pytest.fixture
async def job_id(conn):
    """Insert a queued pipeline job and return its id."""
    await conn.execute(
        "INSERT INTO pipeline_jobs (id, job_type, candidate_id) VALUES (?, 'discovery_only', ?)",
        (JOB_ID_FIXTURE, CANDIDATE_ID),
    )
    await conn.commit()
    return JOB_ID_FIXTURE


async def test_claim_pipeline_job_returns_job(conn, job_id):
    result = await claim_pipeline_job(conn)
    assert result is not None
    assert result['id'] == job_id
    assert result['status'] == 'running'
    assert result['job_type'] == 'discovery_only'


async def test_claim_pipeline_job_returns_none_when_empty(conn):
    result = await claim_pipeline_job(conn)
    assert result is None


async def test_claim_sets_status_to_running_in_db(conn, job_id):
    await claim_pipeline_job(conn)
    async with conn.execute("SELECT status FROM pipeline_jobs WHERE id = ?", (job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'running'


async def test_update_pipeline_job_status_completed(conn, job_id):
    await claim_pipeline_job(conn)
    await update_pipeline_job_status(conn, job_id, 'completed')
    async with conn.execute("SELECT status, completed_at FROM pipeline_jobs WHERE id = ?", (job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'completed'
    assert row[1] is not None


async def test_update_pipeline_job_status_failed_with_error(conn, job_id):
    await update_pipeline_job_status(conn, job_id, 'failed', error='boom')
    async with conn.execute("SELECT status, error FROM pipeline_jobs WHERE id = ?", (job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'failed'
    assert row[1] == 'boom'


async def test_insert_pipeline_run_returns_id(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    assert isinstance(run_id, str) and len(run_id) == 36


async def test_update_pipeline_run(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await update_pipeline_run(conn, run_id, jobsDiscovered=5, status='completed')
    async with conn.execute("SELECT jobs_discovered, status FROM pipeline_runs WHERE id = ?", (run_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 5
    assert row[1] == 'completed'


async def test_get_scan_history_urls_empty(conn):
    urls = await get_scan_history_urls(conn, CANDIDATE_ID)
    assert urls == set()


async def test_bulk_insert_scan_history_and_retrieve(conn):
    entries = [
        {'candidate_id': CANDIDATE_ID, 'url': 'https://example.com/job/1', 'job_id': None},
        {'candidate_id': CANDIDATE_ID, 'url': 'https://example.com/job/2', 'job_id': None},
    ]
    await bulk_insert_scan_history(conn, entries)
    urls = await get_scan_history_urls(conn, CANDIDATE_ID)
    assert urls == {'https://example.com/job/1', 'https://example.com/job/2'}


async def test_bulk_insert_scan_history_upsert(conn):
    entry = {'candidate_id': CANDIDATE_ID, 'url': 'https://example.com/job/1', 'job_id': None}
    await bulk_insert_scan_history(conn, [entry])
    await bulk_insert_scan_history(conn, [entry])  # second insert should upsert, not error
    async with conn.execute("SELECT COUNT(*) FROM scan_history") as cur:
        row = await cur.fetchone()
    assert row[0] == 1


async def test_bulk_insert_jobs(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    jobs = [{
        'candidate_id': CANDIDATE_ID,
        'pipeline_run_id': run_id,
        'title': 'Staff Engineer',
        'company': 'Acme',
        'location': 'Remote',
        'jd_raw': '<html>desc</html>',
        'jd_text': 'desc',
        'source': 'linkedin',
        'source_url': 'https://linkedin.com/jobs/1',
        'application_url': None,
        'posted_at': None,
    }]
    ids = await bulk_insert_jobs(conn, jobs)
    assert len(ids) == 1
    assert isinstance(ids[0], str) and len(ids[0]) == 36


async def test_insert_pipeline_log(conn, job_id):
    await insert_pipeline_log(conn, job_id, 'info', 'start', 'Pipeline started', {'x': 1})
    async with conn.execute("SELECT level, step, message, data FROM pipeline_logs") as cur:
        row = await cur.fetchone()
    assert row[0] == 'info'
    assert row[1] == 'start'
    assert row[2] == 'Pipeline started'
    assert json.loads(row[3]) == {'x': 1}


async def test_get_candidate_preferences(conn):
    prefs = await get_candidate_preferences(conn, CANDIDATE_ID)
    assert prefs == {'enabled_sources': ['linkedin']}


async def test_get_candidate_preferences_missing(conn):
    prefs = await get_candidate_preferences(conn, 'nonexistent-id')
    assert prefs == {}
