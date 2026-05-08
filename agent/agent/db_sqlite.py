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
        now = _now()
        await pool.execute(
            'INSERT INTO jobs '
            '(id, candidate_id, pipeline_run_id, title, company, location, '
            'jd_raw, jd_text, source, source_url, application_url, posted_at, '
            'created_at, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                now,
                now,
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
        now = _now()
        await pool.execute(
            'INSERT INTO scan_history (id, candidate_id, url, job_id, first_seen_at, last_seen_at) '
            'VALUES (?, ?, ?, ?, ?, ?) '
            'ON CONFLICT (candidate_id, url) DO UPDATE SET last_seen_at = ?',
            (_new_id(), entry['candidate_id'], entry['url'], entry.get('job_id'), now, now, now),
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
        'INSERT INTO pipeline_logs (id, pipeline_job_id, level, step, message, data, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        (_new_id(), pipeline_job_id, level, step, message,
         json.dumps(data) if data is not None else None, _now()),
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


async def get_jobs_with_empty_jd(
    pool: aiosqlite.Connection,
    candidate_id: str,
    limit: int = 100,
) -> list[dict]:
    async with pool.execute(
        "SELECT id, source_url FROM jobs "
        "WHERE candidate_id = ? AND jd_raw = '' AND status = 'discovered' "
        "ORDER BY created_at LIMIT ?",
        (candidate_id, limit),
    ) as cursor:
        rows = await cursor.fetchall()
    return [{"id": row[0], "source_url": row[1]} for row in rows]


async def update_job_jd(
    pool: aiosqlite.Connection,
    job_id: str,
    jd_raw: str,
) -> None:
    await pool.execute(
        "UPDATE jobs SET jd_raw = ?, updated_at = ? WHERE id = ?",
        (jd_raw, _now(), job_id),
    )
    await pool.commit()


async def count_jobs_with_empty_jd(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> int:
    async with pool.execute(
        "SELECT COUNT(*) FROM jobs "
        "WHERE candidate_id = ? AND jd_raw = '' AND status = 'discovered'",
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return row[0] if row else 0


async def queue_pipeline_job(
    pool: aiosqlite.Connection,
    candidate_id: str,
    job_type: str,
) -> str:
    job_id = _new_id()
    await pool.execute(
        "INSERT INTO pipeline_jobs (id, status, job_type, candidate_id, payload, created_at) "
        "VALUES (?, 'queued', ?, ?, '{}', ?)",
        (job_id, job_type, candidate_id, _now()),
    )
    await pool.commit()
    return job_id


# ── Scoring DB functions (F9) ─────────────────────────────────────────────────

async def get_jobs_to_score(
    pool: aiosqlite.Connection,
    candidate_id: str,
    job_ids: list[str] | None = None,
) -> list[dict]:
    """Return discovered jobs with non-empty jd_raw that have not yet been scored.

    When `job_ids` is a non-empty list, the result is restricted to that subset
    (still excluding any whose jd_raw is empty or status is not 'discovered').
    Pass None or [] to score every ready job (legacy behaviour).
    """
    base_sql = (
        "SELECT id, title, company, jd_raw, source FROM jobs "
        "WHERE candidate_id = ? AND status = 'discovered' AND jd_raw != ''"
    )
    if job_ids:
        placeholders = ",".join("?" for _ in job_ids)
        sql = f"{base_sql} AND id IN ({placeholders}) ORDER BY created_at"
        params: tuple = (candidate_id, *job_ids)
    else:
        sql = f"{base_sql} ORDER BY created_at"
        params = (candidate_id,)

    async with pool.execute(sql, params) as cursor:
        rows = await cursor.fetchall()
    return [
        {"id": row[0], "title": row[1], "company": row[2],
         "jd_raw": row[3], "source": row[4]}
        for row in rows
    ]


async def count_ready_to_score(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> int:
    """Count jobs in 'discovered' state with non-empty jd_raw — i.e. ready to score."""
    async with pool.execute(
        "SELECT COUNT(*) FROM jobs "
        "WHERE candidate_id = ? AND status = 'discovered' AND jd_raw != ''",
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return row[0] if row else 0


async def update_job_score(
    pool: aiosqlite.Connection,
    job_id: str,
    score_json: dict,
    grade: str,
    report_md: str,
    archetype: str,
    archetype_confidence: float,
) -> None:
    await pool.execute(
        "UPDATE jobs SET status = 'scored', score10d = ?, grade = ?, "
        "report_md = ?, archetype = ?, archetype_confidence = ?, updated_at = ? "
        "WHERE id = ?",
        (json.dumps(score_json), grade, report_md,
         archetype, archetype_confidence, _now(), job_id),
    )
    await pool.commit()


async def mark_job_score_failed(
    pool: aiosqlite.Connection,
    job_id: str,
) -> None:
    await pool.execute(
        "UPDATE jobs SET status = 'score_failed', updated_at = ? WHERE id = ?",
        (_now(), job_id),
    )
    await pool.commit()


# ── Resume Builder DB functions (F10) ─────────────────────────────────────────

async def get_approved_jobs_without_resume(
    pool: aiosqlite.Connection,
    candidate_id: str = "",
) -> list[dict]:
    """Return approved jobs that have no completed resume version."""
    where = "WHERE j.status = 'approved' AND j.id NOT IN (SELECT job_id FROM resume_versions WHERE generation_status = 'completed')"
    params: tuple = ()
    if candidate_id:
        where += " AND j.candidate_id = ?"
        params = (candidate_id,)
    async with pool.execute(
        f"SELECT j.id, j.title, j.company, j.jd_raw, j.candidate_id, j.status, "
        f"j.archetype, j.archetype_confidence FROM jobs j {where} ORDER BY j.created_at",
        params,
    ) as cur:
        rows = await cur.fetchall()
    cols = ["id", "title", "company", "jd_raw", "candidate_id", "status", "archetype", "archetype_confidence"]
    return [dict(zip(cols, row)) for row in rows]


async def insert_resume_version(
    pool: aiosqlite.Connection,
    job_id: str,
    candidate_id: str,
    archetype: str,
    base_cv_hash: str,
    archetype_confidence: float = 1.0,
    keywords: list | None = None,
    score_at_generation: float | None = None,
    resume_pdf_path: str = "",
    cover_letter_pdf_path: str = "",
    generation_status: str = "pending",
    version_n: int = 1,
) -> str:
    vid = _new_id()
    await pool.execute(
        "INSERT INTO resume_versions (id, job_id, candidate_id, archetype, archetype_confidence, "
        "keywords, score_at_generation, resume_pdf_path, cover_letter_pdf_path, base_cv_hash, "
        "generation_status, version_n, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (vid, job_id, candidate_id, archetype, archetype_confidence,
         json.dumps(keywords or []), score_at_generation,
         resume_pdf_path, cover_letter_pdf_path, base_cv_hash,
         generation_status, version_n, _now()),
    )
    await pool.commit()
    return vid


async def get_resume_versions(
    pool: aiosqlite.Connection,
    job_id: str,
) -> list[dict]:
    async with pool.execute(
        "SELECT id, job_id, candidate_id, archetype, archetype_confidence, keywords, "
        "score_at_generation, resume_pdf_path, cover_letter_pdf_path, base_cv_hash, "
        "is_submitted, company_research_used, generation_status, error_message, version_n, created_at "
        "FROM resume_versions WHERE job_id = ? ORDER BY version_n DESC",
        (job_id,),
    ) as cur:
        rows = await cur.fetchall()
    cols = ["id", "job_id", "candidate_id", "archetype", "archetype_confidence", "keywords",
            "score_at_generation", "resume_pdf_path", "cover_letter_pdf_path", "base_cv_hash",
            "is_submitted", "company_research_used", "generation_status", "error_message",
            "version_n", "created_at"]
    return [dict(zip(cols, row)) for row in rows]


async def mark_resume_failed(
    pool: aiosqlite.Connection,
    job_id: str,
    error: str,
) -> None:
    await pool.execute(
        "UPDATE resume_versions SET generation_status = 'failed', error_message = ? "
        "WHERE job_id = ? AND generation_status != 'completed'",
        (error, job_id),
    )
    await pool.execute(
        "UPDATE jobs SET status = 'resume_failed' WHERE id = ?",
        (job_id,),
    )
    await pool.commit()


async def lock_submitted_resume(
    pool: aiosqlite.Connection,
    version_id: str,
) -> None:
    async with pool.execute(
        "SELECT is_submitted FROM resume_versions WHERE id = ?", (version_id,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        raise ValueError(f"Resume version {version_id} not found")
    if row[0]:
        raise ValueError(f"Resume version {version_id} is already submitted")
    await pool.execute(
        "UPDATE resume_versions SET is_submitted = 1 WHERE id = ?",
        (version_id,),
    )
    await pool.commit()


async def update_resume_version_status(
    pool: aiosqlite.Connection,
    version_id: str,
    status: str,
    resume_pdf_path: str = "",
    cover_letter_pdf_path: str = "",
) -> None:
    await pool.execute(
        "UPDATE resume_versions SET generation_status = ?, "
        "resume_pdf_path = ?, cover_letter_pdf_path = ? WHERE id = ?",
        (status, resume_pdf_path, cover_letter_pdf_path, version_id),
    )
    await pool.commit()


# ── HITL Snooze Resurface (F4) ────────────────────────────────────────────────

async def get_snoozed_jobs_to_resurface(
    pool: aiosqlite.Connection,
) -> list[dict]:
    """Return HITL checkpoints whose snooze has expired."""
    now = _now()
    async with pool.execute(
        "SELECT hc.id, hc.job_id FROM hitl_checkpoints hc "
        "WHERE hc.status = 'snoozed' AND hc.snoozed_until <= ?",
        (now,),
    ) as cursor:
        rows = await cursor.fetchall()
    return [{"checkpoint_id": row[0], "job_id": row[1]} for row in rows]


async def resurface_snoozed_job(
    pool: aiosqlite.Connection,
    checkpoint_id: str,
    job_id: str,
) -> None:
    """Reset a snoozed job to awaiting status."""
    await pool.execute(
        "UPDATE hitl_checkpoints SET status = 'awaiting', snoozed_until = NULL WHERE id = ?",
        (checkpoint_id,),
    )
    await pool.execute(
        "UPDATE jobs SET status = 'awaiting', updated_at = ? WHERE id = ?",
        (_now(), job_id),
    )
    await pool.commit()

