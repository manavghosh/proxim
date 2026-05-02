"""LangGraph for scoring discovered jobs with the 10D framework."""
from __future__ import annotations
from datetime import datetime, timezone
import structlog
from langgraph.graph import StateGraph, END
from agent.models import ScoringState

logger = structlog.get_logger()


async def _make_pool():
    from agent.config import settings
    from agent.db import create_pool
    return await create_pool(settings.database_url)


async def _close_pool(pool) -> None:
    from agent.db import close_pool
    await close_pool(pool)


async def _log(pool, job_id: str, level: str, step: str,
               message: str, data: dict | None = None) -> None:
    try:
        from agent.db import insert_pipeline_log
        await insert_pipeline_log(pool, job_id, level=level,
                                  step=step, message=message, data=data)
    except Exception as e:
        logger.warning("log_write_failed", error=str(e))


async def _load_candidate_context(pool, candidate_id: str) -> tuple[dict, dict]:
    """Load parsed_profile and preferences from candidates table."""
    import json
    if hasattr(pool, 'execute'):  # aiosqlite
        async with pool.execute(
            'SELECT parsed_profile, preferences FROM candidates WHERE id = ?',
            (candidate_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return {}, {}
        profile = json.loads(row[0]) if isinstance(row[0], str) else (row[0] or {})
        prefs = json.loads(row[1]) if isinstance(row[1], str) else (row[1] or {})
        return profile, prefs
    else:  # asyncpg pool
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT parsed_profile, preferences FROM candidates WHERE id = $1',
                candidate_id,
            )
        if not row:
            return {}, {}
        return dict(row['parsed_profile'] or {}), dict(row['preferences'] or {})


# ── Node: load_jobs ───────────────────────────────────────────────────────────

async def load_jobs(state: ScoringState) -> dict:
    """Load all discovered jobs with non-empty jd_raw ready to be scored."""
    pool = await _make_pool()
    try:
        from agent.db import get_jobs_to_score
        jobs = await get_jobs_to_score(pool, state.candidate_id)
        await _log(pool, state.pipeline_job_id, "info", "load_jobs",
                   f"Found {len(jobs)} jobs to score",
                   {"count": len(jobs)})
        logger.info("scoring_load", count=len(jobs))
    finally:
        await _close_pool(pool)
    return {"jobs_to_score": jobs}


# ── Node: score_and_report_batch ──────────────────────────────────────────────

async def score_and_report_batch(state: ScoringState) -> dict:
    """Score each job with LiteLLM and save to DB immediately after each job."""
    from agent.scoring_engine import score_job, generate_report
    from agent.db import update_job_score, mark_job_score_failed

    if not state.jobs_to_score:
        logger.info("score_batch_skip", reason="no jobs to score")
        return {"scored_count": 0, "failed_count": 0, "skipped_count": 0}

    pool = await _make_pool()
    scored = 0
    failed = 0
    skipped = 0
    total = len(state.jobs_to_score)

    try:
        parsed_profile, preferences = await _load_candidate_context(pool, state.candidate_id)

        await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                   f"Scoring {total} jobs…", {"total": total})

        for job in state.jobs_to_score:
            try:
                score_output = await score_job(job, parsed_profile, preferences)
                report = await generate_report(job, parsed_profile, score_output)

                score_json = {
                    "gate": {
                        "role_level_match":   score_output.gate.role_level_match.model_dump(),
                        "ai_stack_alignment": score_output.gate.ai_stack_alignment.model_dump(),
                    },
                    "weighted": {
                        k: getattr(score_output.weighted, k).model_dump()
                        for k in [
                            "compensation", "company_stage", "interview_probability",
                            "thought_leadership", "geography", "growth_trajectory",
                            "domain_resonance", "hiring_urgency",
                        ]
                    },
                }

                blocks = [
                    f"## Executive Summary\n{report.block_a}",
                    f"## CV Match\n{report.block_b}" if report.block_b else "",
                    f"## Gaps & Mitigation\n{report.block_c}" if report.block_c else "",
                    f"## Level & Positioning\n{report.block_d}" if report.block_d else "",
                    f"## Compensation Analysis\n{report.block_e}" if report.block_e else "",
                    f"## Interview Probability\n{report.block_f}" if report.block_f else "",
                ]
                report_md = "\n\n".join(b for b in blocks if b).strip()

                await update_job_score(
                    pool, job["id"],
                    score_json=score_json,
                    grade=score_output.grade,
                    report_md=report_md,
                    archetype=score_output.archetype,
                    archetype_confidence=score_output.archetype_confidence,
                )

                if score_output.grade == "F":
                    skipped += 1
                    await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                               f"Job {scored + failed + skipped}/{total} — Grade F (gate fail): "
                               f"{job['title']} @ {job['company']}",
                               {"job_id": job["id"], "grade": "F"})
                else:
                    scored += 1
                    await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                               f"Scored {scored}/{total} — {score_output.grade} "
                               f"({score_output.numeric_score}): {job['title']} @ {job['company']}",
                               {"grade": score_output.grade, "score": score_output.numeric_score,
                                "archetype": score_output.archetype})

            except Exception as e:
                failed += 1
                logger.error("score_job_error", job_id=job.get("id"), error=str(e))
                try:
                    await mark_job_score_failed(pool, job["id"])
                except Exception:
                    pass
                is_rate_limit = "rate" in str(e).lower() or "429" in str(e)
                short_error = str(e)[:120]
                if is_rate_limit:
                    log_msg = f"Skipped: {job.get('title')} @ {job.get('company')} — rate limit (re-run score_jobs to retry)"
                else:
                    log_msg = f"Skipped: {job.get('title')} @ {job.get('company')} — {short_error} (marked score_failed)"
                await _log(pool, state.pipeline_job_id, "warning", "score_and_report_batch",
                           log_msg,
                           {"job_id": job.get("id"), "error": str(e)})

            # Polite delay between jobs to stay within Anthropic rate limits
            import asyncio
            await asyncio.sleep(2)

        await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                   f"Scoring complete — {scored} graded A–D, {skipped} F-grade, {failed} failed",
                   {"scored": scored, "skipped": skipped, "failed": failed})
        logger.info("score_batch_done", scored=scored, skipped=skipped, failed=failed)

    finally:
        await _close_pool(pool)

    return {"scored_count": scored, "failed_count": failed, "skipped_count": skipped}


# ── Node: write_score_summary ─────────────────────────────────────────────────

async def write_score_summary(state: ScoringState) -> dict:
    """Mark the score_jobs pipeline job as completed and log the summary."""
    pool = await _make_pool()
    try:
        from agent.db import update_pipeline_run, update_pipeline_job_status

        now = datetime.now(timezone.utc).isoformat()
        try:
            await update_pipeline_run(
                pool, state.pipeline_run_id,
                status="completed",
                completedAt=now,
                jobsDiscovered=state.scored_count,
            )
        except Exception as e:
            logger.error("write_score_summary_run_update_failed", error=str(e))
            await update_pipeline_run(pool, state.pipeline_run_id,
                                      status="completed", completedAt=now)

        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        pending_msg = f", {state.failed_count} failed" if state.failed_count else ""
        await _log(pool, state.pipeline_job_id, "info", "write_score_summary",
                   f"Scoring complete — {state.scored_count} graded A–D, "
                   f"{state.skipped_count} F-grade filtered{pending_msg}",
                   {"scored": state.scored_count, "skipped": state.skipped_count,
                    "failed": state.failed_count})

        logger.info("scoring_pipeline_complete",
                    scored=state.scored_count,
                    skipped=state.skipped_count,
                    failed=state.failed_count)

    except Exception as e:
        logger.error("write_score_summary_failed", error=str(e))
        try:
            await update_pipeline_job_status(
                pool, state.pipeline_job_id, "failed", error=str(e)
            )
        except Exception:
            pass
    finally:
        await _close_pool(pool)

    return {}


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_scoring_graph():
    graph = StateGraph(ScoringState)
    graph.add_node("load_jobs",              load_jobs)
    graph.add_node("score_and_report_batch", score_and_report_batch)
    graph.add_node("write_score_summary",    write_score_summary)

    graph.set_entry_point("load_jobs")
    graph.add_edge("load_jobs",              "score_and_report_batch")
    graph.add_edge("score_and_report_batch", "write_score_summary")
    graph.add_edge("write_score_summary",    END)

    return graph.compile()


scoring_graph = build_scoring_graph()
