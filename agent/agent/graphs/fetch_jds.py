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
    """Load all discovered jobs with empty jd_raw (capped at JD_FETCH_LIMIT)."""
    pool = await _make_pool()
    try:
        from agent.db import get_jobs_with_empty_jd
        jobs = await get_jobs_with_empty_jd(
            pool, state.candidate_id, limit=JD_FETCH_LIMIT
        )
        await _log(pool, state.pipeline_job_id, "info", "load_jobs",
                   f"Found {len(jobs)} jobs needing JD fetch",
                   {"count": len(jobs)})
        logger.info("fetch_jds_load", count=len(jobs))
    finally:
        await _close_pool(pool)
    return {"jobs_to_fetch": jobs}


# ── Node: fetch_jds_batch ─────────────────────────────────────────────────────

async def fetch_jds_batch(state: FetchJdsState) -> dict:
    """Visit each job detail page and update jd_raw in the database."""
    from agent.scrapers.linkedin_jd import LinkedInJdScraper

    if not state.jobs_to_fetch:
        logger.info("fetch_jds_batch_skip", reason="no jobs to fetch")
        return {"fetched_count": 0, "failed_count": 0}

    pool = await _make_pool()
    scraper = LinkedInJdScraper()
    fetched = 0
    failed = 0

    try:
        await _log(pool, state.pipeline_job_id, "info", "fetch_jds_batch",
                   f"Fetching JDs for {len(state.jobs_to_fetch)} jobs…",
                   {"total": len(state.jobs_to_fetch)})

        results = await scraper.fetch_jds(state.jobs_to_fetch)

        from agent.db import update_job_jd
        for job_id, jd_text in results:
            if jd_text:
                await update_job_jd(pool, job_id, jd_text)
                fetched += 1
            else:
                failed += 1

        await _log(pool, state.pipeline_job_id, "info", "fetch_jds_batch",
                   f"JD fetch complete — {fetched} fetched, {failed} failed",
                   {"fetched": fetched, "failed": failed})
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

        pending_msg = f", {state.failed_count} still pending" if state.failed_count else ""
        await _log(pool, state.pipeline_job_id, "info", "write_fetch_summary",
                   f"JD fetch complete — {state.fetched_count} updated{pending_msg}",
                   {"fetched": state.fetched_count, "pending": state.failed_count})

        logger.info("fetch_jds_complete",
                    fetched=state.fetched_count, failed=state.failed_count)

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
