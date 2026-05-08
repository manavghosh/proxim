"""Unit tests for resume DB functions using in-memory SQLite."""
import json
import uuid
import pytest
import aiosqlite

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Test Candidate',
    base_cv_hash TEXT,
    parse_status TEXT NOT NULL DEFAULT 'pending',
    preferences TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    job_type TEXT NOT NULL,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    payload TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    pipeline_job_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    pipeline_run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    jd_raw TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'naukri',
    source_url TEXT NOT NULL DEFAULT 'http://x.com',
    status TEXT NOT NULL DEFAULT 'discovered',
    archetype TEXT,
    archetype_confidence REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resume_versions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    candidate_id TEXT REFERENCES candidates(id),
    archetype TEXT NOT NULL,
    archetype_confidence REAL,
    keywords TEXT,
    score_at_generation REAL,
    resume_pdf_path TEXT,
    cover_letter_pdf_path TEXT,
    base_cv_hash TEXT NOT NULL,
    is_submitted INTEGER NOT NULL DEFAULT 0,
    company_research_used INTEGER NOT NULL DEFAULT 0,
    generation_status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    version_n INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CANDIDATE_ID = str(uuid.uuid4())
JOB_ID = str(uuid.uuid4())
RUN_ID = str(uuid.uuid4())
PIPELINE_JOB_ID = str(uuid.uuid4())


@pytest.fixture
async def conn():
    db = await aiosqlite.connect(":memory:")
    await db.executescript(SCHEMA_SQL)
    await db.execute("INSERT INTO candidates (id) VALUES (?)", (CANDIDATE_ID,))
    await db.execute(
        "INSERT INTO pipeline_jobs (id, job_type, candidate_id) VALUES (?, 'score_jobs', ?)",
        (PIPELINE_JOB_ID, CANDIDATE_ID),
    )
    await db.execute(
        "INSERT INTO pipeline_runs (id, pipeline_job_id, candidate_id) VALUES (?, ?, ?)",
        (RUN_ID, PIPELINE_JOB_ID, CANDIDATE_ID),
    )
    await db.execute(
        "INSERT INTO jobs (id, candidate_id, pipeline_run_id, title, company, status) VALUES (?, ?, ?, 'VP AI', 'Acme', 'approved')",
        (JOB_ID, CANDIDATE_ID, RUN_ID),
    )
    await db.commit()
    yield db
    await db.close()


async def test_get_approved_jobs_without_resume_returns_jobs_with_approved_status(conn):
    from agent.db_sqlite import get_approved_jobs_without_resume
    jobs = await get_approved_jobs_without_resume(conn)
    assert len(jobs) == 1
    assert jobs[0]['id'] == JOB_ID
    assert jobs[0]['status'] == 'approved'


async def test_get_approved_jobs_without_resume_excludes_jobs_with_existing_completed_version(conn):
    from agent.db_sqlite import get_approved_jobs_without_resume
    version_id = str(uuid.uuid4())
    await conn.execute(
        "INSERT INTO resume_versions (id, job_id, candidate_id, archetype, base_cv_hash, generation_status) "
        "VALUES (?, ?, ?, 'Agentic Systems Architect', 'abc123', 'completed')",
        (version_id, JOB_ID, CANDIDATE_ID),
    )
    await conn.commit()
    jobs = await get_approved_jobs_without_resume(conn)
    assert len(jobs) == 0


async def test_insert_resume_version_returns_uuid(conn):
    from agent.db_sqlite import insert_resume_version
    vid = await insert_resume_version(
        conn,
        job_id=JOB_ID,
        candidate_id=CANDIDATE_ID,
        archetype="Agentic Systems Architect",
        base_cv_hash="abc123",
    )
    assert vid is not None
    assert len(vid) == 36  # UUID format


async def test_mark_resume_failed_sets_status_and_error_message(conn):
    from agent.db_sqlite import insert_resume_version, mark_resume_failed
    vid = await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                      archetype="Agentic Systems Architect", base_cv_hash="x")
    await mark_resume_failed(conn, JOB_ID, "LLM timeout")
    async with conn.execute("SELECT generation_status, error_message FROM resume_versions WHERE id = ?", (vid,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'failed'
    assert row[1] == "LLM timeout"


async def test_lock_submitted_resume_sets_is_submitted_true(conn):
    from agent.db_sqlite import insert_resume_version, lock_submitted_resume
    vid = await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                      archetype="Agentic Systems Architect", base_cv_hash="x")
    await lock_submitted_resume(conn, vid)
    async with conn.execute("SELECT is_submitted FROM resume_versions WHERE id = ?", (vid,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 1


async def test_lock_submitted_resume_raises_if_already_submitted(conn):
    from agent.db_sqlite import insert_resume_version, lock_submitted_resume
    vid = await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                      archetype="Agentic Systems Architect", base_cv_hash="x")
    await lock_submitted_resume(conn, vid)
    with pytest.raises(ValueError, match="already submitted"):
        await lock_submitted_resume(conn, vid)
