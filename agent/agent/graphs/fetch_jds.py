"""LangGraph for fetching LinkedIn job descriptions for discovered jobs with empty jd_raw."""
from __future__ import annotations
from datetime import datetime, timezone
import structlog
from langgraph.graph import StateGraph, END
from agent.models import FetchJdsState

logger = structlog.get_logger()

JD_FETCH_LIMIT = 100


async def _make_pool():
    from agent.config import settings
    from agent.db import create_pool
    return await create_pool(settings.database_url)


async def _close_pool(pool) -> None:
    from agent.db import close_pool
    await close_pool(pool)


async def _log(pool, job_id: str, level: str, step: str, message: str,
               data: dict | None = None) -> None:
    try:
        from agent.db import insert_pipeline_log
        await insert_pipeline_log(pool, job_id, level=level,
                                  step=step, message=message, data=data)
    except Exception as e:
        logger.warning("log_write_failed", error=str(e))


# ── Node: load_jobs ───────────────────────────────────────────────────────────

async def load_jobs(state: FetchJdsState) -> dict:
    """Load all discovered jobs with empty jd_raw (capped at JD_FETCH_LIMIT).

    fetch_jds currently only fetches LinkedIn JDs — Naukri/IIMJobs populate
    jd_raw inline during discovery — so the log message reflects that.
    """
    from agent.telemetry import get_tracer
    pool = await _make_pool()
    try:
        from agent.db import get_jobs_with_empty_jd
        with get_tracer().start_as_current_span("fetch_jds") as span:
            span.set_attribute("agent_name", "fetch_jds")
            span.set_attribute("pipeline_run_id", state.pipeline_run_id or "")
            span.set_attribute("candidate_id", state.candidate_id or "")
            jobs = await get_jobs_with_empty_jd(
                pool, state.candidate_id, limit=JD_FETCH_LIMIT
            )
        await _log(pool, state.pipeline_job_id, "info", "load_jobs",
                   f"Found {len(jobs)} LinkedIn jobs needing JD fetch",
                   {"count": len(jobs), "source": "linkedin"})
        logger.info("fetch_jds_load", count=len(jobs), source="linkedin")
    finally:
        await _close_pool(pool)
    return {"jobs_to_fetch": jobs}


# ── Node: fetch_jds_batch ─────────────────────────────────────────────────────

async def fetch_jds_batch(state: FetchJdsState) -> dict:
    """Visit each job detail page and save jd_raw immediately after each fetch."""
    from agent.scrapers.linkedin_jd import LinkedInJdScraper
    from agent.db import update_job_jd

    if not state.jobs_to_fetch:
        logger.info("fetch_jds_batch_skip", reason="no jobs to fetch")
        return {"fetched_count": 0, "failed_count": 0}

    pool = await _make_pool()
    scraper = LinkedInJdScraper()
    fetched = 0
    failed = 0
    total = len(state.jobs_to_fetch)

    try:
        await _log(pool, state.pipeline_job_id, "info", "fetch_jds_batch",
                   f"Fetching JDs from LinkedIn for {total} jobs…",
                   {"total": total, "source": "linkedin"})

        async def on_fetched(job_id: str, jd_text: str) -> None:
            """Save each JD to the DB immediately after it is fetched."""
            nonlocal fetched, failed
            if jd_text:
                await update_job_jd(pool, job_id, jd_text)
                fetched += 1
                words = len(jd_text.split())
                await _log(pool, state.pipeline_job_id, "info", "fetch_jds_batch",
                           f"LinkedIn JD {fetched}/{total} saved — {words} words",
                           {"fetched": fetched, "total": total, "words": words, "source": "linkedin"})
            else:
                failed += 1
                await _log(pool, state.pipeline_job_id, "warning", "fetch_jds_batch",
                           f"LinkedIn JD unavailable for job {fetched + failed}/{total} — will retry next run",
                           {"fetched": fetched, "failed": failed, "total": total, "source": "linkedin"})

        await scraper.fetch_jds(state.jobs_to_fetch, on_fetched=on_fetched)

        await _log(pool, state.pipeline_job_id, "info", "fetch_jds_batch",
                   f"LinkedIn JD fetch complete — {fetched} saved, {failed} unavailable",
                   {"fetched": fetched, "failed": failed, "source": "linkedin"})
        logger.info("fetch_jds_batch_done", fetched=fetched, failed=failed)

    finally:
        await _close_pool(pool)

    return {"fetched_count": fetched, "failed_count": failed}


# ── Node: write_fetch_summary ─────────────────────────────────────────────────

async def write_fetch_summary(state: FetchJdsState) -> dict:
    """Mark the fetch_jds pipeline job as completed and log the summary."""
    pool = await _make_pool()
    try:
        from agent.db import update_pipeline_run, update_pipeline_job_status

        now = datetime.now(timezone.utc).isoformat()
        try:
            await update_pipeline_run(
                pool, state.pipeline_run_id,
                status="completed",
                completedAt=now,
                jobsDiscovered=state.fetched_count,
            )
        except Exception as e:
            logger.error("write_fetch_summary_run_update_failed", error=str(e))
            await update_pipeline_run(pool, state.pipeline_run_id,
                                      status="completed", completedAt=now)

        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        # Gate scoring on user review — emit review_required log instead of auto-queueing.
        from agent.db import count_ready_to_score
        ready_count = await count_ready_to_score(pool, state.candidate_id)
        if ready_count > 0:
            await _log(pool, state.pipeline_job_id, "info", "review_required",
                       f"Ready to score {ready_count} jobs — open the dashboard "
                       f"and select positions to score",
                       {"ready_count": ready_count})

        pending_msg = f", {state.failed_count} still pending" if state.failed_count else ""
        await _log(pool, state.pipeline_job_id, "info", "write_fetch_summary",
                   f"JD fetch complete — {state.fetched_count} updated{pending_msg}. "
                   f"{ready_count} jobs awaiting user review before scoring.",
                   {"fetched": state.fetched_count, "pending": state.failed_count,
                    "ready_count": ready_count})

        logger.info("fetch_jds_complete",
                    fetched=state.fetched_count, failed=state.failed_count,
                    ready_count=ready_count)

    except Exception as e:
        logger.error("write_fetch_summary_failed", error=str(e))
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

def build_fetch_jds_graph():
    graph = StateGraph(FetchJdsState)
    graph.add_node("load_jobs",           load_jobs)
    graph.add_node("fetch_jds_batch",     fetch_jds_batch)
    graph.add_node("write_fetch_summary", write_fetch_summary)

    graph.set_entry_point("load_jobs")
    graph.add_edge("load_jobs",           "fetch_jds_batch")
    graph.add_edge("fetch_jds_batch",     "write_fetch_summary")
    graph.add_edge("write_fetch_summary", END)

    return graph.compile()


fetch_jds_graph = build_fetch_jds_graph()
