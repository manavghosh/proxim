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
    get_jobs_with_empty_jd,
    update_job_jd,
    count_jobs_with_empty_jd,
    queue_pipeline_job,
    get_jobs_to_score,
    update_job_score,
    mark_job_score_failed,
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
    score10d TEXT,
    grade TEXT,
    report_md TEXT,
    archetype TEXT,
    archetype_confidence REAL,
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


# ── New DB functions for JD fetch ─────────────────────────────────────────────

_JOB_FIXTURE = {
    'candidate_id': CANDIDATE_ID,
    'pipeline_run_id': None,  # filled in per-test
    'title': 'AI Director',
    'company': 'Acme',
    'location': 'Bengaluru',
    'jd_raw': '',
    'jd_text': '',
    'source': 'linkedin',
    'source_url': 'https://linkedin.com/jobs/view/123',
    'application_url': None,
    'posted_at': None,
}


async def test_count_jobs_with_empty_jd_returns_zero_when_no_jobs(conn):
    count = await count_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert count == 0


async def test_get_jobs_with_empty_jd_returns_empty_when_no_jobs(conn):
    result = await get_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert result == []


async def test_update_job_jd_updates_jd_raw(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    inserted_ids = await bulk_insert_jobs(conn, [{**_JOB_FIXTURE, 'pipeline_run_id': run_id}])
    inserted_job_id = inserted_ids[0]
    await update_job_jd(conn, inserted_job_id, 'We are hiring an AI Director…')
    async with conn.execute('SELECT jd_raw FROM jobs WHERE id = ?', (inserted_job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'We are hiring an AI Director…'


async def test_count_jobs_with_empty_jd_counts_correctly(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await bulk_insert_jobs(conn, [
        {**_JOB_FIXTURE, 'pipeline_run_id': run_id, 'jd_raw': '',
         'source_url': 'https://linkedin.com/jobs/1'},
        {**_JOB_FIXTURE, 'pipeline_run_id': run_id, 'jd_raw': 'has jd',
         'source_url': 'https://linkedin.com/jobs/2'},
    ])
    count = await count_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert count == 1


async def test_get_jobs_with_empty_jd_returns_only_empty_ones(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await bulk_insert_jobs(conn, [
        {**_JOB_FIXTURE, 'pipeline_run_id': run_id, 'jd_raw': '',
         'source_url': 'https://linkedin.com/jobs/1'},
        {**_JOB_FIXTURE, 'pipeline_run_id': run_id, 'jd_raw': 'has jd',
         'source_url': 'https://linkedin.com/jobs/2'},
    ])
    jobs = await get_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert len(jobs) == 1
    assert jobs[0]['source_url'] == 'https://linkedin.com/jobs/1'
    assert 'id' in jobs[0]


async def test_queue_pipeline_job_inserts_queued_job(conn):
    new_job_id = await queue_pipeline_job(conn, CANDIDATE_ID, 'fetch_jds')
    assert new_job_id is not None
    async with conn.execute(
        'SELECT status, job_type FROM pipeline_jobs WHERE id = ?', (new_job_id,)
    ) as cur:
        row = await cur.fetchone()
    assert row[0] == 'queued'
    assert row[1] == 'fetch_jds'


# ── Scoring DB functions (T010) ───────────────────────────────────────────────

async def test_get_jobs_to_score_returns_discovered_with_jd(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    ids = await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE,
        'pipeline_run_id': run_id,
        'jd_raw': 'We are hiring a Director of AI with LangGraph experience.',
        'source_url': 'https://linkedin.com/jobs/score-1',
    }])
    result = await get_jobs_to_score(conn, CANDIDATE_ID)
    assert len(result) == 1
    assert result[0]['id'] == ids[0]
    assert 'jd_raw' in result[0]
    assert 'title' in result[0]


async def test_get_jobs_to_score_skips_empty_jd(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE,
        'pipeline_run_id': run_id,
        'jd_raw': '',
        'source_url': 'https://linkedin.com/jobs/score-2',
    }])
    result = await get_jobs_to_score(conn, CANDIDATE_ID)
    assert result == []


async def test_update_job_score_persists_all_fields(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    ids = await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE,
        'pipeline_run_id': run_id,
        'jd_raw': 'JD text here',
        'source_url': 'https://linkedin.com/jobs/score-3',
    }])
    j_id = ids[0]
    score_json = {'gate': {'role_level_match': {'score': 4.0, 'reasoning': 'test'}}, 'weighted': {}}
    await update_job_score(
        conn, j_id,
        score_json=score_json,
        grade='B',
        report_md='## Report\n\nContent here.',
        archetype='GCC AI Practice Head',
        archetype_confidence=0.82,
    )
    async with conn.execute(
        'SELECT grade, report_md, archetype, archetype_confidence, status FROM jobs WHERE id = ?',
        (j_id,)
    ) as cur:
        row = await cur.fetchone()
    assert row[0] == 'B'
    assert row[1] == '## Report\n\nContent here.'
    assert row[2] == 'GCC AI Practice Head'
    assert row[3] == pytest.approx(0.82, rel=1e-2)
    assert row[4] == 'scored'


async def test_mark_job_score_failed_sets_status(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    ids = await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE,
        'pipeline_run_id': run_id,
        'jd_raw': 'JD',
        'source_url': 'https://linkedin.com/jobs/score-4',
    }])
    j_id = ids[0]
    await mark_job_score_failed(conn, j_id)
    async with conn.execute('SELECT status FROM jobs WHERE id = ?', (j_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'score_failed'
