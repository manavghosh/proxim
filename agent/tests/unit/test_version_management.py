"""Tests for resume version management in db_sqlite.py."""
import json
import uuid
import pytest
import aiosqlite

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Test',
    base_cv_hash TEXT
);
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    job_type TEXT NOT NULL,
    candidate_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    pipeline_job_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    pipeline_run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    jd_raw TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'naukri',
    source_url TEXT NOT NULL DEFAULT 'http://x.com',
    status TEXT NOT NULL DEFAULT 'approved',
    archetype TEXT,
    archetype_confidence REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resume_versions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    candidate_id TEXT,
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
    await db.execute("INSERT INTO candidates (id, base_cv_hash) VALUES (?, 'hash_v1')", (CANDIDATE_ID,))
    await db.execute(
        "INSERT INTO pipeline_jobs (id, job_type, candidate_id) VALUES (?, 'score_jobs', ?)",
        (PIPELINE_JOB_ID, CANDIDATE_ID),
    )
    await db.execute(
        "INSERT INTO pipeline_runs (id, pipeline_job_id, candidate_id) VALUES (?, ?, ?)",
        (RUN_ID, PIPELINE_JOB_ID, CANDIDATE_ID),
    )
    await db.execute(
        "INSERT INTO jobs (id, candidate_id, pipeline_run_id, title, company, status) "
        "VALUES (?, ?, ?, 'VP AI', 'Acme', 'approved')",
        (JOB_ID, CANDIDATE_ID, RUN_ID),
    )
    await db.commit()
    yield db
    await db.close()


async def test_store_version_creates_new_version_when_previous_exists(conn):
    from agent.db_sqlite import insert_resume_version
    v1 = await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                     archetype="Agentic Systems Architect", base_cv_hash="hash_v1",
                                     version_n=1)
    v2 = await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                     archetype="Agentic Systems Architect", base_cv_hash="hash_v2",
                                     version_n=2)
    assert v1 != v2
    async with conn.execute("SELECT COUNT(*) FROM resume_versions WHERE job_id = ?", (JOB_ID,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 2


async def test_store_version_does_not_overwrite_submitted_version(conn):
    from agent.db_sqlite import insert_resume_version, lock_submitted_resume
    v1 = await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                     archetype="Agentic Systems Architect", base_cv_hash="hash_v1")
    await lock_submitted_resume(conn, v1)
    # Insert a second version — v1 should remain submitted
    await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                archetype="Agentic Systems Architect", base_cv_hash="hash_v2",
                                version_n=2)
    async with conn.execute("SELECT is_submitted FROM resume_versions WHERE id = ?", (v1,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 1  # still submitted, not overwritten


async def test_lock_submitted_resume_idempotent_raises_on_second_call(conn):
    from agent.db_sqlite import insert_resume_version, lock_submitted_resume
    v1 = await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                     archetype="Agentic Systems Architect", base_cv_hash="x")
    await lock_submitted_resume(conn, v1)
    with pytest.raises(ValueError, match="already submitted"):
        await lock_submitted_resume(conn, v1)


async def test_get_resume_versions_returns_newest_first(conn):
    from agent.db_sqlite import insert_resume_version, get_resume_versions
    await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                archetype="Agentic Systems Architect", base_cv_hash="h1", version_n=1)
    await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                archetype="Agentic Systems Architect", base_cv_hash="h2", version_n=2)
    versions = await get_resume_versions(conn, JOB_ID)
    assert len(versions) == 2
    assert versions[0]["version_n"] == 2  # newest first


async def test_staleness_detected_when_cv_hash_differs(conn):
    from agent.db_sqlite import insert_resume_version, get_resume_versions
    await insert_resume_version(conn, job_id=JOB_ID, candidate_id=CANDIDATE_ID,
                                archetype="Agentic Systems Architect", base_cv_hash="old_hash")
    # Simulate CV update
    await conn.execute("UPDATE candidates SET base_cv_hash = 'new_hash' WHERE id = ?", (CANDIDATE_ID,))
    await conn.commit()
    async with conn.execute("SELECT base_cv_hash FROM candidates WHERE id = ?", (CANDIDATE_ID,)) as cur:
        row = await cur.fetchone()
    current_hash = row[0]
    versions = await get_resume_versions(conn, JOB_ID)
    is_stale = versions[0]["base_cv_hash"] != current_hash
    assert is_stale is True
