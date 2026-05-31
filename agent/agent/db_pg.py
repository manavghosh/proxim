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


async def get_pipeline_job_status(
    pool: asyncpg.Pool,
    job_id: str,
) -> str | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT status FROM pipeline_jobs WHERE id = $1', job_id
        )
    return row['status'] if row else None


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


async def update_run_aggregates(pool: asyncpg.Pool, run_id: str) -> None:
    """Populate F7 aggregate columns on pipeline_runs at run completion.

    Called once when a pipeline run transitions to 'completed'. Fire-and-forget
    — errors are logged but never re-raised so the pipeline completion is not
    blocked by an aggregation failure.
    """
    import structlog
    _log = structlog.get_logger()
    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                UPDATE pipeline_runs SET
                  ab_grade_count = (
                    SELECT COUNT(*) FROM jobs
                    WHERE pipeline_run_id = $1 AND grade IN ('A','B')
                  ),
                  resumes_generated = (
                    SELECT COUNT(*) FROM resume_versions rv
                    JOIN jobs j ON j.id = rv.job_id
                    WHERE j.pipeline_run_id = $1
                  ),
                  emails_sent = (
                    SELECT COUNT(*) FROM email_drafts ed
                    JOIN email_cadences ec ON ec.id = ed.cadence_id
                    JOIN jobs j ON j.id = ec.job_id
                    WHERE j.pipeline_run_id = $1 AND ed.status = 'sent'
                  ),
                  replies_received = (
                    SELECT COUNT(*) FROM email_cadences ec
                    JOIN jobs j ON j.id = ec.job_id
                    WHERE j.pipeline_run_id = $1 AND ec.reply_detected_at IS NOT NULL
                  )
                WHERE id = $1
            """, run_id)
    except Exception as exc:
        _log.warning("update_run_aggregates_failed", run_id=run_id, error=str(exc))


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


async def get_candidate_name(pool: asyncpg.Pool, candidate_id: str) -> str:
    """Return the candidate's display name (empty string if unknown)."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT name FROM candidates WHERE id = $1",
            candidate_id,
        )
    return row['name'] if row and row['name'] else ''


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
    payload: dict | None = None,
) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO pipeline_jobs (job_type, candidate_id, payload) "
            "VALUES ($1, $2, $3) RETURNING id",
            job_type, candidate_id, payload or {},
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
    error_message: str = "",
) -> None:
    async with pool.acquire() as conn:
        if error_message:
            await conn.execute(
                "UPDATE jobs SET status = 'score_failed', error_message = $1, updated_at = NOW() WHERE id = $2",
                error_message[:500], job_id,
            )
        else:
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


# ── LinkedIn Connector DB functions (F5) ──────────────────────────────────────

async def get_outreach_target(
    pool: asyncpg.Pool,
    target_id: str,
) -> dict | None:
    """Return a single outreach_target row as a dict, or None if not found."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, job_id, candidate_id, company, linkedin_url, title, seniority, "
            "enrichment_json, note_a, note_b, selected_note, edited_note, status "
            "FROM outreach_targets WHERE id = $1",
            target_id,
        )
    if row is None:
        return None
    result = dict(row)
    result["id"] = str(result["id"])
    result["job_id"] = str(result["job_id"])
    result["candidate_id"] = str(result["candidate_id"])
    return result


async def insert_outreach_target(
    pool: asyncpg.Pool,
    job_id: str,
    candidate_id: str,
    company: str,
) -> str:
    """Insert a new outreach_targets row with status='pending'. Returns the new id."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO outreach_targets (job_id, candidate_id, company, status) "
            "VALUES ($1, $2, $3, 'pending') RETURNING id",
            job_id, candidate_id, company,
        )
    return str(row["id"])


async def update_outreach_target(
    pool: asyncpg.Pool,
    target_id: str,
    **kwargs: object,
) -> None:
    """Dynamically UPDATE outreach_targets columns for the given target_id."""
    if not kwargs:
        return
    import json
    set_clauses: list[str] = []
    values: list[object] = []
    for i, (key, val) in enumerate(kwargs.items(), start=1):
        col = _to_snake(key)
        if isinstance(val, (dict, list)):
            set_clauses.append(f"{col} = ${i}::jsonb")
            values.append(json.dumps(val))
        else:
            set_clauses.append(f"{col} = ${i}")
            values.append(val)
    set_clauses.append("updated_at = NOW()")
    values.append(target_id)
    query = f"UPDATE outreach_targets SET {', '.join(set_clauses)} WHERE id = ${len(values)}"
    async with pool.acquire() as conn:
        await conn.execute(query, *values)


async def get_queued_outreach_targets(
    pool: asyncpg.Pool,
    candidate_id: str,
) -> list[dict]:
    """Return outreach targets with status='queued' for a candidate."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, job_id, candidate_id, company, note_a, note_b, "
            "selected_note, edited_note, linkedin_url "
            "FROM outreach_targets "
            "WHERE candidate_id = $1 AND status = 'queued' "
            "ORDER BY created_at",
            candidate_id,
        )
    return [
        {
            "id": str(r["id"]), "job_id": str(r["job_id"]),
            "candidate_id": str(r["candidate_id"]), "company": r["company"],
            "note_a": r["note_a"], "note_b": r["note_b"],
            "selected_note": r["selected_note"], "edited_note": r["edited_note"],
            "linkedin_url": r["linkedin_url"],
        }
        for r in rows
    ]


async def get_sent_outreach_targets_for_polling(
    pool: asyncpg.Pool,
) -> list[dict]:
    """Return sent targets due for acceptance polling (>24 h since last poll)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, candidate_id, linkedin_invitation_id "
            "FROM outreach_targets "
            "WHERE status = 'sent' "
            "AND (last_polled_at IS NULL "
            "     OR last_polled_at < NOW() - INTERVAL '24 hours') "
            "ORDER BY sent_at",
        )
    return [
        {
            "id": str(r["id"]),
            "candidate_id": str(r["candidate_id"]),
            "linkedin_invitation_id": r["linkedin_invitation_id"],
        }
        for r in rows
    ]


async def get_daily_send_count(
    pool: asyncpg.Pool,
    candidate_id: str,
) -> int:
    """Count connection requests sent today (UTC) for this candidate."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(*) AS c FROM outreach_targets "
            "WHERE candidate_id = $1 AND status = 'sent' "
            "AND sent_at::date = CURRENT_DATE",
            candidate_id,
        )
    return row["c"] if row else 0


# ── Outreach Mailer Agent (F6) ────────────────────────────────────────────────

async def insert_email_cadence(
    pool: asyncpg.Pool,
    job_id: str,
    candidate_id: str,
) -> str:
    """Insert a new email_cadences row with status=pending_discovery. Returns cadence id."""
    import uuid as _uuid
    cadence_id = str(_uuid.uuid4())
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO email_cadences (id, job_id, candidate_id, status, created_at, updated_at) "
            "VALUES ($1, $2, $3, 'pending_discovery', NOW(), NOW())",
            cadence_id, job_id, candidate_id,
        )
    return cadence_id


async def update_email_cadence(
    pool: asyncpg.Pool,
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
    for i, (k, v) in enumerate(kwargs.items(), start=1):
        col = col_map.get(k, k)
        sets.append(f"{col} = ${i}")
        values.append(v)
    idx = len(values) + 1
    sets.append(f"updated_at = NOW()")
    values.append(cadence_id)
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE email_cadences SET {', '.join(sets)} WHERE id = ${idx}",
            *values,
        )


async def insert_email_drafts(
    pool: asyncpg.Pool,
    cadence_id: str,
    candidate_id: str,
    drafts: list[dict],
) -> None:
    """Batch insert email_drafts rows (one per day)."""
    import uuid as _uuid
    async with pool.acquire() as conn:
        for d in drafts:
            draft_id = str(_uuid.uuid4())
            await conn.execute(
                "INSERT INTO email_drafts "
                "(id, cadence_id, candidate_id, day_number, subject, body_html, body_text, "
                "original_body_html, is_approved, status, created_at, updated_at) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'draft', NOW(), NOW())",
                draft_id, cadence_id, candidate_id,
                d["day_number"], d["subject"],
                d["body_html"], d["body_text"], d["original_body_html"],
            )


async def update_email_draft(
    pool: asyncpg.Pool,
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
    for i, (k, v) in enumerate(kwargs.items(), start=1):
        col = col_map.get(k, k)
        sets.append(f"{col} = ${i}")
        values.append(v)
    idx = len(values) + 1
    sets.append(f"updated_at = NOW()")
    values.append(draft_id)
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE email_drafts SET {', '.join(sets)} WHERE id = ${idx}",
            *values,
        )


async def get_scheduled_drafts(pool: asyncpg.Pool) -> list[dict]:
    """Return email drafts ready to send (scheduled_send_at elapsed, no reply/bounce)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT ed.id, ed.cadence_id, ed.candidate_id, ed.day_number, "
            "ed.subject, ed.body_html, ed.body_text, ed.scheduled_send_at, "
            "ec.gmail_thread_id, ec.day1_message_id, ec.hiring_manager_email, ec.status AS cadence_status "
            "FROM email_drafts ed "
            "JOIN email_cadences ec ON ec.id = ed.cadence_id "
            "WHERE ed.status IN ('scheduled', 'approved') "
            "AND ed.scheduled_send_at <= NOW() "
            "AND ec.status IN ('approved', 'active') "
            "AND ec.reply_detected_at IS NULL "
            "AND ec.bounce_detected_at IS NULL "
            "ORDER BY ed.scheduled_send_at "
            "LIMIT 10 "
            "FOR UPDATE OF ed SKIP LOCKED"
        )
    return [dict(r) for r in rows]


async def get_active_cadences_for_polling(pool: asyncpg.Pool) -> list[dict]:
    """Return active cadences with a day1 message ID set (for reply/bounce detection)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, candidate_id, day1_message_id, gmail_thread_id "
            "FROM email_cadences "
            "WHERE status = 'active' AND day1_message_id IS NOT NULL"
        )
    return [dict(r) for r in rows]


async def get_daily_email_send_count(
    pool: asyncpg.Pool,
    candidate_id: str,
) -> int:
    """Count emails sent today (UTC) for this candidate across all cadences."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(*) AS c FROM email_drafts "
            "WHERE candidate_id = $1 AND status = 'sent' "
            "AND sent_at::date = CURRENT_DATE",
            candidate_id,
        )
    return row["c"] if row else 0


async def get_resume_version_for_send(
    pool: asyncpg.Pool,
    candidate_id: str,
    job_id: str,
) -> dict | None:
    """Return the latest resume version with a PDF path for Day 1 attachment."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, resume_pdf_path, cover_letter_pdf_path FROM resume_versions "
            "WHERE candidate_id = $1 AND job_id = $2 "
            "AND resume_pdf_path IS NOT NULL "
            "ORDER BY created_at DESC LIMIT 1",
            candidate_id, job_id,
        )
    if row is None:
        return None
    return dict(row)


async def get_cadence_drafts(pool: asyncpg.Pool, cadence_id: str) -> list[dict]:
    """Return all email drafts for a cadence."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, day_number, status, scheduled_send_at FROM email_drafts "
            "WHERE cadence_id = $1 ORDER BY day_number",
            cadence_id,
        )
    return [dict(r) for r in rows]


async def cancel_pending_drafts(pool: asyncpg.Pool, cadence_id: str) -> None:
    """Cancel all scheduled/approved drafts for a cadence (reply detected)."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE email_drafts SET status = 'cancelled', updated_at = NOW() "
            "WHERE cadence_id = $1 AND status IN ('scheduled', 'approved')",
            cadence_id,
        )


async def get_jobs_by_ids(pool: asyncpg.Pool, job_ids: list[str]) -> list[dict]:
    """Return jobs matching the given IDs."""
    if not job_ids:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, source_url, source, title, company FROM jobs WHERE id = ANY($1)",
            job_ids,
        )
    return [dict(r) for r in rows]


async def update_job_meta(
    pool: asyncpg.Pool,
    job_id: str,
    title: str,
    company: str,
    jd_raw: str,
) -> None:
    """Update title, company, and jd_raw for an imported job."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET title = $1, company = $2, jd_raw = $3, updated_at = NOW() WHERE id = $4",
            title, company, jd_raw, job_id,
        )


async def bounce_day1_cancel_day3_day7(pool: asyncpg.Pool, cadence_id: str) -> None:
    """Mark Day 1 as bounced; cancel Day 3 and Day 7 (bounce detected)."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE email_drafts SET status = 'bounced', bounce_detected_at = NOW(), updated_at = NOW() "
            "WHERE cadence_id = $1 AND day_number = 1",
            cadence_id,
        )
        await conn.execute(
            "UPDATE email_drafts SET status = 'cancelled', updated_at = NOW() "
            "WHERE cadence_id = $1 AND day_number IN (3, 7)",
            cadence_id,
        )
