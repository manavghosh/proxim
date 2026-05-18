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


async def get_candidate_name(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> str:
    """Return the candidate's display name (empty string if unknown)."""
    async with pool.execute(
        'SELECT name FROM candidates WHERE id = ?',
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return row[0] if row and row[0] else ''


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


# ── LinkedIn Connector DB functions (F5) ──────────────────────────────────────

async def get_outreach_target(
    pool: aiosqlite.Connection,
    target_id: str,
) -> dict | None:
    """Return a single outreach_target row as a dict, or None if not found."""
    async with pool.execute(
        "SELECT id, job_id, candidate_id, company, linkedin_url, title, seniority, "
        "enrichment_json, note_a, note_b, selected_note, edited_note, status "
        "FROM outreach_targets WHERE id = ?",
        (target_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        return None
    cols = ["id", "job_id", "candidate_id", "company", "linkedin_url", "title",
            "seniority", "enrichment_json", "note_a", "note_b",
            "selected_note", "edited_note", "status"]
    result = dict(zip(cols, row))
    if isinstance(result.get("enrichment_json"), str):
        import json as _json
        try:
            result["enrichment_json"] = _json.loads(result["enrichment_json"])
        except Exception:
            pass
    return result


async def insert_outreach_target(
    pool: aiosqlite.Connection,
    job_id: str,
    candidate_id: str,
    company: str,
) -> str:
    """Insert a new outreach_targets row with status='pending'. Returns the row id.

    Uses INSERT OR IGNORE so re-processing a job after a daemon crash doesn't
    raise a UNIQUE violation — the existing row's id is returned instead.
    """
    target_id = _new_id()
    now = _now()
    await pool.execute(
        "INSERT OR IGNORE INTO outreach_targets "
        "(id, job_id, candidate_id, company, status, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        (target_id, job_id, candidate_id, company, now, now),
    )
    await pool.commit()
    async with pool.execute(
        "SELECT id FROM outreach_targets WHERE job_id = ?", (job_id,)
    ) as cursor:
        row = await cursor.fetchone()
    return row[0]


async def update_outreach_target(
    pool: aiosqlite.Connection,
    target_id: str,
    **kwargs: object,
) -> None:
    """Dynamically UPDATE outreach_targets columns for the given target_id."""
    if not kwargs:
        return
    cols: list[str] = []
    values: list[object] = []
    for key, val in kwargs.items():
        cols.append(f"{_to_snake(key)} = ?")
        if isinstance(val, (dict, list)):
            values.append(json.dumps(val))
        else:
            values.append(val)
    cols.append("updated_at = ?")
    values.append(_now())
    values.append(target_id)
    await pool.execute(
        f"UPDATE outreach_targets SET {', '.join(cols)} WHERE id = ?",
        values,
    )
    await pool.commit()


async def get_queued_outreach_targets(
    pool: aiosqlite.Connection,
    candidate_id: str = "",
) -> list[dict]:
    """Return outreach targets with status='queued'.

    When candidate_id is empty, returns queued targets across ALL candidates.
    """
    if candidate_id:
        sql    = ("SELECT id, job_id, candidate_id, company, note_a, note_b, "
                  "selected_note, edited_note, linkedin_url "
                  "FROM outreach_targets WHERE candidate_id = ? AND status = 'queued' "
                  "ORDER BY created_at")
        params: tuple = (candidate_id,)
    else:
        sql    = ("SELECT id, job_id, candidate_id, company, note_a, note_b, "
                  "selected_note, edited_note, linkedin_url "
                  "FROM outreach_targets WHERE status = 'queued' "
                  "ORDER BY created_at")
        params = ()
    async with pool.execute(sql, params) as cursor:
        rows = await cursor.fetchall()
    cols = ["id", "job_id", "candidate_id", "company", "note_a", "note_b",
            "selected_note", "edited_note", "linkedin_url"]
    return [dict(zip(cols, row)) for row in rows]


async def get_sent_outreach_targets_for_polling(
    pool: aiosqlite.Connection,
) -> list[dict]:
    """Return sent targets due for acceptance polling (>24 h since last poll)."""
    async with pool.execute(
        "SELECT id, candidate_id, linkedin_invitation_id "
        "FROM outreach_targets "
        "WHERE status = 'sent' "
        "AND (last_polled_at IS NULL "
        "     OR last_polled_at < datetime('now', '-24 hours')) "
        "ORDER BY sent_at",
    ) as cursor:
        rows = await cursor.fetchall()
    cols = ["id", "candidate_id", "linkedin_invitation_id"]
    return [dict(zip(cols, row)) for row in rows]


async def get_daily_send_count(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> int:
    """Count connection requests sent today (UTC) for this candidate."""
    async with pool.execute(
        "SELECT COUNT(*) FROM outreach_targets "
        "WHERE candidate_id = ? AND status = 'sent' "
        "AND date(sent_at) = date('now')",
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return row[0] if row else 0


async def reset_stale_pipeline_jobs(pool: aiosqlite.Connection) -> int:
    """Reset pipeline_jobs left in 'running' state back to 'queued'.

    Called once at daemon startup. A 'running' job after startup means the
    daemon was killed mid-flight; re-queueing lets the poll loop re-dispatch
    it automatically so the user doesn't have to manually retry from the UI.
    """
    cursor = await pool.execute(
        "UPDATE pipeline_jobs SET status = 'queued', started_at = NULL "
        "WHERE status = 'running'",
    )
    await pool.commit()
    return cursor.rowcount


async def reset_stale_linkedin_outreach(pool: aiosqlite.Connection) -> int:
    """Reset outreach_targets stuck in in-flight states to 'failed'.

    Called once at daemon startup so the UI shows Retry buttons for any work
    that wasn't re-queued by reset_stale_pipeline_jobs (e.g. orphaned rows).
    Includes 'pending' since that state is set before the first node fires.
    """
    cursor = await pool.execute(
        "UPDATE outreach_targets SET status = 'failed', updated_at = ? "
        "WHERE status IN ('pending', 'discovering', 'enriching', 'generating')",
        (_now(),),
    )
    await pool.commit()
    return cursor.rowcount


async def reset_stale_email_cadences(pool: aiosqlite.Connection) -> int:
    """Reset email_cadences stuck in in-flight states to 'failed'.

    Same pattern as reset_stale_linkedin_outreach — cleans up interrupted work
    so the UI shows a Retry button on next load.
    """
    cursor = await pool.execute(
        "UPDATE email_cadences SET status = 'failed', updated_at = ? "
        "WHERE status IN ('discovering', 'generating')",
        (_now(),),
    )
    await pool.commit()
    return cursor.rowcount


# ── Outreach Mailer Agent (F6) ────────────────────────────────────────────────

async def insert_email_cadence(
    pool: aiosqlite.Connection,
    job_id: str,
    candidate_id: str,
) -> str:
    """Insert a new email_cadences row with status=pending_discovery. Returns cadence id.

    Uses INSERT OR IGNORE so re-dispatching after a daemon crash doesn't raise
    a UNIQUE violation — the existing row's id is returned instead.
    """
    cadence_id = _new_id()
    now = _now()
    await pool.execute(
        "INSERT OR IGNORE INTO email_cadences (id, job_id, candidate_id, status, created_at, updated_at) "
        "VALUES (?, ?, ?, 'pending_discovery', ?, ?)",
        (cadence_id, job_id, candidate_id, now, now),
    )
    await pool.commit()
    async with pool.execute(
        "SELECT id FROM email_cadences WHERE job_id = ?", (job_id,)
    ) as cursor:
        row = await cursor.fetchone()
    return row[0]


async def update_email_cadence(
    pool: aiosqlite.Connection,
    cadence_id: str,
    **kwargs,
) -> None:
    """Dynamically update email_cadences columns by keyword argument."""
    if not kwargs:
        return
    col_map = {
        "status": "status",
        "hiring_manager_email": "hiring_manager_email",
        "email_confidence": "email_confidence",
        "email_source": "email_source",
        "gmail_thread_id": "gmail_thread_id",
        "day1_message_id": "day1_message_id",
        "approved_at": "approved_at",
        "reply_detected_at": "reply_detected_at",
        "bounce_detected_at": "bounce_detected_at",
        "error_message": "error_message",
    }
    sets, values = [], []
    for k, v in kwargs.items():
        col = col_map.get(k, k)
        sets.append(f"{col} = ?")
        values.append(v)
    sets.append("updated_at = ?")
    values.append(_now())
    values.append(cadence_id)
    await pool.execute(
        f"UPDATE email_cadences SET {', '.join(sets)} WHERE id = ?",
        values,
    )
    await pool.commit()


async def insert_email_drafts(
    pool: aiosqlite.Connection,
    cadence_id: str,
    candidate_id: str,
    drafts: list[dict],
) -> None:
    """Batch insert email_drafts rows (one per day).

    Deletes any existing 'draft' rows for the cadence first so that
    re-dispatching after a daemon restart replaces rather than duplicates them.
    Rows already in sent/approved/scheduled/manually_sent status are left alone.
    """
    await pool.execute(
        "DELETE FROM email_drafts WHERE cadence_id = ? AND status = 'draft'",
        (cadence_id,),
    )
    now = _now()
    for d in drafts:
        draft_id = _new_id()
        await pool.execute(
            "INSERT INTO email_drafts "
            "(id, cadence_id, candidate_id, day_number, subject, body_html, body_text, "
            "original_body_html, is_approved, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?)",
            (
                draft_id, cadence_id, candidate_id,
                d["day_number"], d["subject"],
                d["body_html"], d["body_text"], d["original_body_html"],
                now, now,
            ),
        )
    await pool.commit()


async def update_email_draft(
    pool: aiosqlite.Connection,
    draft_id: str,
    **kwargs,
) -> None:
    """Dynamically update email_drafts columns by keyword argument."""
    if not kwargs:
        return
    col_map = {
        "status": "status",
        "is_approved": "is_approved",
        "scheduled_send_at": "scheduled_send_at",
        "sent_at": "sent_at",
        "gmail_message_id": "gmail_message_id",
        "open_detected_at": "open_detected_at",
        "click_detected_at": "click_detected_at",
        "bounce_detected_at": "bounce_detected_at",
        "body_html": "body_html",
        "body_text": "body_text",
    }
    sets, values = [], []
    for k, v in kwargs.items():
        col = col_map.get(k, k)
        sets.append(f"{col} = ?")
        values.append(v)
    sets.append("updated_at = ?")
    values.append(_now())
    values.append(draft_id)
    await pool.execute(
        f"UPDATE email_drafts SET {', '.join(sets)} WHERE id = ?",
        values,
    )
    await pool.commit()


async def get_scheduled_drafts(pool: aiosqlite.Connection) -> list[dict]:
    """Return email drafts ready to send (scheduled_send_at elapsed, no reply/bounce)."""
    async with pool.execute(
        "SELECT ed.id, ed.cadence_id, ed.candidate_id, ed.day_number, "
        "ed.subject, ed.body_html, ed.body_text, ed.scheduled_send_at, "
        "ec.gmail_thread_id, ec.day1_message_id, ec.hiring_manager_email, ec.status AS cadence_status, "
        "ec.job_id "
        "FROM email_drafts ed "
        "JOIN email_cadences ec ON ec.id = ed.cadence_id "
        "WHERE ed.status IN ('scheduled', 'approved') "
        "AND datetime(replace(replace(ed.scheduled_send_at, 'T', ' '), '+00:00', '')) <= datetime('now') "
        "AND ec.status IN ('approved', 'active') "
        "AND ec.reply_detected_at IS NULL "
        "AND ec.bounce_detected_at IS NULL "
        "ORDER BY ed.scheduled_send_at "
        "LIMIT 10"
    ) as cursor:
        rows = await cursor.fetchall()
    cols = [
        "id", "cadence_id", "candidate_id", "day_number",
        "subject", "body_html", "body_text", "scheduled_send_at",
        "gmail_thread_id", "day1_message_id", "hiring_manager_email", "cadence_status",
        "job_id",
    ]
    return [dict(zip(cols, row)) for row in rows]


async def get_active_cadences_for_polling(pool: aiosqlite.Connection) -> list[dict]:
    """Return active cadences with a day1 message ID set (for reply/bounce detection)."""
    async with pool.execute(
        "SELECT id, candidate_id, day1_message_id, gmail_thread_id "
        "FROM email_cadences "
        "WHERE status = 'active' AND day1_message_id IS NOT NULL"
    ) as cursor:
        rows = await cursor.fetchall()
    cols = ["id", "candidate_id", "day1_message_id", "gmail_thread_id"]
    return [dict(zip(cols, row)) for row in rows]


async def get_daily_email_send_count(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> int:
    """Count emails sent today (UTC) for this candidate across all cadences."""
    async with pool.execute(
        "SELECT COUNT(*) FROM email_drafts "
        "WHERE candidate_id = ? AND status = 'sent' "
        "AND date(sent_at) = date('now')",
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return row[0] if row else 0


async def get_resume_version_for_send(
    pool: aiosqlite.Connection,
    candidate_id: str,
    job_id: str,
) -> dict | None:
    """Return the latest resume version with a PDF path for Day 1 attachment."""
    async with pool.execute(
        "SELECT id, resume_pdf_path, cover_letter_pdf_path FROM resume_versions "
        "WHERE candidate_id = ? AND job_id = ? "
        "AND resume_pdf_path IS NOT NULL "
        "ORDER BY created_at DESC LIMIT 1",
        (candidate_id, job_id),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        return None
    return {"id": row[0], "resume_pdf_path": row[1], "cover_letter_pdf_path": row[2]}


async def get_cadence_drafts(
    pool: aiosqlite.Connection,
    cadence_id: str,
) -> list[dict]:
    """Return all email drafts for a cadence."""
    async with pool.execute(
        "SELECT id, day_number, status, scheduled_send_at FROM email_drafts "
        "WHERE cadence_id = ? ORDER BY day_number",
        (cadence_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    cols = ["id", "day_number", "status", "scheduled_send_at"]
    return [dict(zip(cols, row)) for row in rows]


async def cancel_pending_drafts(
    pool: aiosqlite.Connection,
    cadence_id: str,
) -> None:
    """Cancel all scheduled/approved drafts for a cadence (reply detected)."""
    await pool.execute(
        "UPDATE email_drafts SET status = 'cancelled', updated_at = ? "
        "WHERE cadence_id = ? AND status IN ('scheduled', 'approved')",
        (_now(), cadence_id),
    )
    await pool.commit()


async def bounce_day1_cancel_day3_day7(
    pool: aiosqlite.Connection,
    cadence_id: str,
) -> None:
    """Mark Day 1 as bounced; cancel Day 3 and Day 7 (bounce detected)."""
    now = _now()
    await pool.execute(
        "UPDATE email_drafts SET status = 'bounced', bounce_detected_at = ?, updated_at = ? "
        "WHERE cadence_id = ? AND day_number = 1",
        (now, now, cadence_id),
    )
    await pool.execute(
        "UPDATE email_drafts SET status = 'cancelled', updated_at = ? "
        "WHERE cadence_id = ? AND day_number IN (3, 7)",
        (now, cadence_id),
    )
    await pool.commit()


# ── Job Import (import_jobs pipeline type) ────────────────────────────────────

async def get_jobs_by_ids(
    pool: aiosqlite.Connection,
    job_ids: list[str],
) -> list[dict]:
    """Return jobs matching the given IDs."""
    if not job_ids:
        return []
    placeholders = ",".join("?" * len(job_ids))
    async with pool.execute(
        f"SELECT id, source_url, source, title, company FROM jobs WHERE id IN ({placeholders})",
        job_ids,
    ) as cursor:
        rows = await cursor.fetchall()
    cols = ["id", "source_url", "source", "title", "company"]
    return [dict(zip(cols, row)) for row in rows]


async def update_job_meta(
    pool: aiosqlite.Connection,
    job_id: str,
    title: str,
    company: str,
    jd_raw: str,
) -> None:
    """Update title, company, and jd_raw for an imported job."""
    await pool.execute(
        "UPDATE jobs SET title = ?, company = ?, jd_raw = ?, updated_at = ? WHERE id = ?",
        (title, company, jd_raw, _now(), job_id),
    )
    await pool.commit()

