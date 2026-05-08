"""PostgreSQL database query functions for the Proxim agent (production)."""
import asyncpg
from typing import Optional


async def create_pool(database_url: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(database_url, min_size=1, max_size=5)


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()


async def claim_pipeline_job(pool: asyncpg.Pool) -> Optional[dict]:
    """
    Atomically claim one queued pipeline job.
    Uses FOR UPDATE SKIP LOCKED to prevent double-pickup by concurrent workers.
    Returns the claimed job as a dict (with status already set to 'running'), or None.
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE pipeline_jobs
            SET status = 'running', started_at = NOW()
            WHERE id = (
                SELECT id FROM pipeline_jobs
                WHERE status = 'queued'
                ORDER BY created_at
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, status, job_type, candidate_id, payload
        """)
        if row is None:
            return None
        result = dict(row)
        result['status'] = 'running'
        return result


async def update_pipeline_job_status(
    pool: asyncpg.Pool,
    job_id: str,
    status: str,
    error: Optional[str] = None,
) -> None:
    async with pool.acquire() as conn:
        if status in ('completed', 'failed'):
            await conn.execute("""
                UPDATE pipeline_jobs
                SET status = $1, completed_at = NOW(), error = $2
                WHERE id = $3
            """, status, error, job_id)
        else:
            await conn.execute("""
                UPDATE pipeline_jobs SET status = $1 WHERE id = $2
            """, status, job_id)


async def insert_pipeline_run(
    pool: asyncpg.Pool,
    pipeline_job_id: str,
    candidate_id: str,
) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO pipeline_runs (pipeline_job_id, candidate_id, status)
            VALUES ($1, $2, 'running')
            RETURNING id
        """, pipeline_job_id, candidate_id)
        return str(row['id'])


async def update_pipeline_run(pool: asyncpg.Pool, run_id: str, **kwargs) -> None:
    if not kwargs:
        return
    import json
    set_clauses = []
    values = []
    for i, (key, value) in enumerate(kwargs.items(), start=1):
        col = _to_snake(key)
        # asyncpg requires dicts/lists to be JSON strings for JSONB columns
        if isinstance(value, (dict, list)):
            set_clauses.append(f"{col} = ${i}::jsonb")
            values.append(json.dumps(value))
        else:
            set_clauses.append(f"{col} = ${i}")
            values.append(value)
    values.append(run_id)
    query = f"UPDATE pipeline_runs SET {', '.join(set_clauses)} WHERE id = ${len(values)}"
    async with pool.acquire() as conn:
        await conn.execute(query, *values)


async def get_scan_history_urls(pool: asyncpg.Pool, candidate_id: str) -> set[str]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT url FROM scan_history WHERE candidate_id = $1
        """, candidate_id)
        return {row['url'] for row in rows}


async def bulk_insert_jobs(pool: asyncpg.Pool, jobs: list[dict]) -> list[str]:
    if not jobs:
        return []
    async with pool.acquire() as conn:
        ids = []
        for job in jobs:
            row = await conn.fetchrow("""
                INSERT INTO jobs
                  (candidate_id, pipeline_run_id, title, company, location,
                   jd_raw, jd_text, source, source_url, application_url, posted_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                RETURNING id
            """,
                job['candidate_id'], job['pipeline_run_id'], job['title'],
                job['company'], job.get('location'), job['jd_raw'],
                job.get('jd_text'), job['source'], job['source_url'],
                job.get('application_url'), job.get('posted_at'),
            )
            ids.append(str(row['id']))
        return ids


async def bulk_insert_scan_history(pool: asyncpg.Pool, entries: list[dict]) -> None:
    if not entries:
        return
    async with pool.acquire() as conn:
        for entry in entries:
            await conn.execute("""
                INSERT INTO scan_history (candidate_id, url, job_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (candidate_id, url) DO UPDATE SET last_seen_at = NOW()
            """, entry['candidate_id'], entry['url'], entry.get('job_id'))


async def insert_pipeline_log(
    pool: asyncpg.Pool,
    pipeline_job_id: str,
    level: str,
    step: str,
    message: str,
    data: dict | None = None,
) -> None:
    """Write one log entry to pipeline_logs for the given pipeline job."""
    import json
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO pipeline_logs (pipeline_job_id, level, step, message, data)
            VALUES ($1, $2, $3, $4, $5)
            """,
            pipeline_job_id,
            level,
            step,
            message,
            json.dumps(data) if data is not None else None,
        )


async def get_candidate_preferences(pool: asyncpg.Pool, candidate_id: str) -> dict:
    """Load the candidate's saved preferences from the candidates table."""
    import json
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT preferences FROM candidates WHERE id = $1",
            candidate_id,
        )
        if not row or not row['preferences']:
            return {}
        prefs = row['preferences']
        if isinstance(prefs, str):
            return json.loads(prefs)
        return dict(prefs)


def _to_snake(name: str) -> str:
    import re
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


async def get_jobs_with_empty_jd(
    pool: asyncpg.Pool,
    candidate_id: str,
    limit: int = 100,
) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, source_url FROM jobs "
            "WHERE candidate_id = $1 AND jd_raw = '' AND status = 'discovered' "
            "ORDER BY created_at LIMIT $2",
            candidate_id, limit,
        )
    return [{"id": str(row["id"]), "source_url": row["source_url"]} for row in rows]


async def update_job_jd(
    pool: asyncpg.Pool,
    job_id: str,
    jd_raw: str,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET jd_raw = $1, updated_at = NOW() WHERE id = $2",
            jd_raw, job_id,
        )


async def count_jobs_with_empty_jd(
    pool: asyncpg.Pool,
    candidate_id: str,
) -> int:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(*) AS c FROM jobs "
            "WHERE candidate_id = $1 AND jd_raw = '' AND status = 'discovered'",
            candidate_id,
        )
    return row["c"] if row else 0


async def queue_pipeline_job(
    pool: asyncpg.Pool,
    candidate_id: str,
    job_type: str,
) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO pipeline_jobs (job_type, candidate_id, payload) "
            "VALUES ($1, $2, $3) RETURNING id",
            job_type, candidate_id, {},
        )
    return str(row["id"])


# ── Scoring DB functions (F9) ─────────────────────────────────────────────────

async def get_jobs_to_score(
    pool: asyncpg.Pool,
    candidate_id: str,
    job_ids: list[str] | None = None,
) -> list[dict]:
    """Return discovered jobs with non-empty jd_raw that have not yet been scored.

    When `job_ids` is a non-empty list, the result is restricted to that subset
    (still excluding any whose jd_raw is empty or status is not 'discovered').
    Pass None or [] to score every ready job (legacy behaviour).
    """
    async with pool.acquire() as conn:
        if job_ids:
            rows = await conn.fetch(
                "SELECT id, title, company, jd_raw, source FROM jobs "
                "WHERE candidate_id = $1 AND status = 'discovered' AND jd_raw != '' "
                "AND id = ANY($2::uuid[]) "
                "ORDER BY created_at",
                candidate_id, job_ids,
            )
        else:
            rows = await conn.fetch(
                "SELECT id, title, company, jd_raw, source FROM jobs "
                "WHERE candidate_id = $1 AND status = 'discovered' AND jd_raw != '' "
                "ORDER BY created_at",
                candidate_id,
            )
    return [
        {"id": str(row["id"]), "title": row["title"], "company": row["company"],
         "jd_raw": row["jd_raw"], "source": row["source"]}
        for row in rows
    ]


async def count_ready_to_score(
    pool: asyncpg.Pool,
    candidate_id: str,
) -> int:
    """Count jobs in 'discovered' state with non-empty jd_raw — i.e. ready to score."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(*) AS c FROM jobs "
            "WHERE candidate_id = $1 AND status = 'discovered' AND jd_raw != ''",
            candidate_id,
        )
    return row["c"] if row else 0


async def update_job_score(
    pool: asyncpg.Pool,
    job_id: str,
    score_json: dict,
    grade: str,
    report_md: str,
    archetype: str,
    archetype_confidence: float,
) -> None:
    import json as _json
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET status = 'scored', score10d = $1::jsonb, grade = $2, "
            "report_md = $3, archetype = $4, archetype_confidence = $5, updated_at = NOW() "
            "WHERE id = $6",
            _json.dumps(score_json), grade, report_md,
            archetype, archetype_confidence, job_id,
        )


async def mark_job_score_failed(
    pool: asyncpg.Pool,
    job_id: str,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET status = 'score_failed', updated_at = NOW() WHERE id = $1",
            job_id,
        )


# ── HITL Snooze Resurface (F4) ────────────────────────────────────────────────

async def get_snoozed_jobs_to_resurface(pool: asyncpg.Pool) -> list[dict]:
    """Return HITL checkpoints whose snooze has expired."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT hc.id, hc.job_id FROM hitl_checkpoints hc
            WHERE hc.status = 'snoozed' AND hc.snoozed_until <= NOW()
        """)
    return [{"checkpoint_id": str(row["id"]), "job_id": str(row["job_id"])} for row in rows]


async def resurface_snoozed_job(
    pool: asyncpg.Pool,
    checkpoint_id: str,
    job_id: str,
) -> None:
    """Reset a snoozed job to awaiting status."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE hitl_checkpoints SET status = 'awaiting', snoozed_until = NULL WHERE id = $1",
            checkpoint_id,
        )
        await conn.execute(
            "UPDATE jobs SET status = 'awaiting', updated_at = NOW() WHERE id = $1",
            job_id,
        )
