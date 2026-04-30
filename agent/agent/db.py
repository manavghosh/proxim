"""Database query functions for the Proxim agent service."""
import asyncpg
from typing import Optional
from datetime import datetime, timezone


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
    set_clauses = []
    values = []
    for i, (key, value) in enumerate(kwargs.items(), start=1):
        col = _to_snake(key)
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


def _to_snake(name: str) -> str:
    import re
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()
