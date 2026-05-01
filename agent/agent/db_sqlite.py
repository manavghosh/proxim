"""SQLite database query functions for the Proxim agent (local dev)."""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

# Single asyncio lock prevents concurrent job claims in the one daemon process.
_claim_lock: asyncio.Lock = asyncio.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _to_snake(name: str) -> str:
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


async def create_pool(database_url: str) -> aiosqlite.Connection:
    """Open a SQLite connection. database_url is a file path (not a postgresql:// URL)."""
    path = database_url
    for prefix in ('sqlite:///', 'sqlite://', 'file:'):
        if path.startswith(prefix):
            path = path[len(prefix):]
            break
    conn = await aiosqlite.connect(path)
    await conn.execute('PRAGMA journal_mode=WAL')
    await conn.execute('PRAGMA foreign_keys=ON')
    return conn


async def close_pool(pool: aiosqlite.Connection) -> None:
    await pool.close()


async def claim_pipeline_job(pool: aiosqlite.Connection) -> Optional[dict]:
    """
    Claim one queued pipeline job using an asyncio.Lock instead of
    FOR UPDATE SKIP LOCKED (safe for single-process local dev).
    """
    async with _claim_lock:
        async with pool.execute(
            "SELECT id, status, job_type, candidate_id, payload "
            "FROM pipeline_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1"
        ) as cursor:
            row = await cursor.fetchone()

        if row is None:
            return None

        job_id = row[0]
        await pool.execute(
            "UPDATE pipeline_jobs SET status = 'running', started_at = ? WHERE id = ?",
            (_now(), job_id),
        )
        await pool.commit()

        return {
            'id': job_id,
            'status': 'running',
            'job_type': row[2],
            'candidate_id': row[3],
            'payload': json.loads(row[4]) if row[4] else {},
        }


async def update_pipeline_job_status(
    pool: aiosqlite.Connection,
    job_id: str,
    status: str,
    error: Optional[str] = None,
) -> None:
    if status in ('completed', 'failed'):
        await pool.execute(
            'UPDATE pipeline_jobs SET status = ?, completed_at = ?, error = ? WHERE id = ?',
            (status, _now(), error, job_id),
        )
    else:
        await pool.execute(
            'UPDATE pipeline_jobs SET status = ? WHERE id = ?',
            (status, job_id),
        )
    await pool.commit()


async def insert_pipeline_run(
    pool: aiosqlite.Connection,
    pipeline_job_id: str,
    candidate_id: str,
) -> str:
    run_id = _new_id()
    await pool.execute(
        "INSERT INTO pipeline_runs (id, pipeline_job_id, candidate_id, status, started_at) "
        "VALUES (?, ?, ?, 'running', ?)",
        (run_id, pipeline_job_id, candidate_id, _now()),
    )
    await pool.commit()
    return run_id


async def update_pipeline_run(
    pool: aiosqlite.Connection,
    run_id: str,
    **kwargs: object,
) -> None:
    if not kwargs:
        return
    from datetime import datetime as _dt
    cols: list[str] = []
    values: list[object] = []
    for key, val in kwargs.items():
        cols.append(f'{_to_snake(key)} = ?')
        if isinstance(val, (dict, list)):
            values.append(json.dumps(val))
        elif isinstance(val, _dt):
            values.append(val.isoformat())
        else:
            values.append(val)
    values.append(run_id)
    await pool.execute(
        f"UPDATE pipeline_runs SET {', '.join(cols)} WHERE id = ?",
        values,
    )
    await pool.commit()


async def get_scan_history_urls(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> set[str]:
    async with pool.execute(
        'SELECT url FROM scan_history WHERE candidate_id = ?',
        (candidate_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    return {row[0] for row in rows}


async def bulk_insert_jobs(
    pool: aiosqlite.Connection,
    jobs: list[dict],
) -> list[str]:
    if not jobs:
        return []
    ids: list[str] = []
    for job in jobs:
        job_id = _new_id()
        posted = job.get('posted_at')
        posted_str = posted.isoformat() if hasattr(posted, 'isoformat') else posted
        await pool.execute(
            'INSERT INTO jobs '
            '(id, candidate_id, pipeline_run_id, title, company, location, '
            'jd_raw, jd_text, source, source_url, application_url, posted_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (
                job_id,
                job['candidate_id'],
                job['pipeline_run_id'],
                job['title'],
                job['company'],
                job.get('location'),
                job['jd_raw'],
                job.get('jd_text'),
                job['source'],
                job['source_url'],
                job.get('application_url'),
                posted_str,
            ),
        )
        ids.append(job_id)
    await pool.commit()
    return ids


async def bulk_insert_scan_history(
    pool: aiosqlite.Connection,
    entries: list[dict],
) -> None:
    if not entries:
        return
    for entry in entries:
        await pool.execute(
            'INSERT INTO scan_history (id, candidate_id, url, job_id) VALUES (?, ?, ?, ?) '
            'ON CONFLICT (candidate_id, url) DO UPDATE SET last_seen_at = ?',
            (_new_id(), entry['candidate_id'], entry['url'], entry.get('job_id'), _now()),
        )
    await pool.commit()


async def insert_pipeline_log(
    pool: aiosqlite.Connection,
    pipeline_job_id: str,
    level: str,
    step: str,
    message: str,
    data: dict | None = None,
) -> None:
    await pool.execute(
        'INSERT INTO pipeline_logs (id, pipeline_job_id, level, step, message, data) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (_new_id(), pipeline_job_id, level, step, message,
         json.dumps(data) if data is not None else None),
    )
    await pool.commit()


async def get_candidate_preferences(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> dict:
    async with pool.execute(
        'SELECT preferences FROM candidates WHERE id = ?',
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None or row[0] is None:
        return {}
    prefs = row[0]
    return json.loads(prefs) if isinstance(prefs, str) else dict(prefs)
