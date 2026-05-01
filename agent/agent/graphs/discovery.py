"""LangGraph discovery graph — fan-out scraping across job sources."""
from __future__ import annotations
from datetime import datetime, timezone
import structlog
from langgraph.graph import StateGraph, END
from langgraph.types import Send
from agent.models import DiscoveryState, NormalisedJob, RunSummary

logger = structlog.get_logger()


async def _log(pool, job_id: str, level: str, step: str, message: str, data: dict | None = None) -> None:
    """Write a pipeline log entry. Never raises — log failures must not crash the pipeline."""
    try:
        from agent.db import insert_pipeline_log
        await insert_pipeline_log(pool, job_id, level=level, step=step, message=message, data=data)
    except Exception as e:
        logger.warning("log_write_failed", error=str(e))


async def _make_pool():
    """Create a DB connection/pool via the dispatcher (SQLite or PG)."""
    from agent.config import settings
    from agent.db import create_pool
    return await create_pool(settings.database_url)


async def _close_pool(pool) -> None:
    from agent.db import close_pool
    await close_pool(pool)


# ── Node: build_queries ───────────────────────────────────────────────────────

async def build_queries(state: DiscoveryState) -> dict:
    """Generate 5-8 search queries per source from candidate preferences."""
    prefs = state.preferences
    seniority_levels: list[str] = prefs.get("seniority_levels", [])
    geo: list[str] = prefs.get("geographic_preference", [])

    base_queries = seniority_levels[:8] if seniority_levels else [
        "CAIO", "Chief AI Officer", "VP AI", "Head of AI",
        "Director AI", "AI Practice Head", "LangGraph engineer",
    ]

    if geo and base_queries:
        location_hint = geo[0] if isinstance(geo, list) else geo
        base_queries = [f"{base_queries[0]} {location_hint}"] + base_queries[1:]

    # Build query map for all supported sources, then filter to enabled_sources.
    # If no sources are explicitly selected, all standard sources are active.
    enabled: list[str] = prefs.get("enabled_sources", [])
    all_queries = {
        "naukri":   base_queries,
        "iimjobs":  base_queries[:5],
        "linkedin": base_queries[:3],
    }
    queries = {k: v for k, v in all_queries.items() if k in enabled} if enabled else all_queries

    total = sum(len(v) for v in queries.values())

    logger.info(
        "pipeline_step",
        step="build_queries",
        status="complete",
        sources=list(queries.keys()),
        total_queries=total,
        sample_queries=base_queries[:3],
    )

    pool = await _make_pool()
    try:
        active_sources = list(queries.keys())
        await _log(pool, state.pipeline_job_id, "info", "build_queries",
                   f"Starting pipeline — sources: {active_sources or 'none selected'}",
                   {"sources": active_sources})
        await _log(pool, state.pipeline_job_id, "info", "build_queries",
                   f"Generated {total} queries for {active_sources}",
                   {"total_queries": total, "sources": active_sources})
    finally:
        await _close_pool(pool)

    return {"queries": queries}


# ── Node: fan_out ─────────────────────────────────────────────────────────────

def fan_out(state: DiscoveryState) -> list[Send]:
    """Dispatch scraper nodes based on enabled_sources preference."""
    enabled: list[str] = state.preferences.get("enabled_sources", [])
    standard_sources = ["naukri", "iimjobs", "linkedin"]
    active = enabled if enabled else standard_sources

    sends: list[Send] = []

    for source in active:
        if source in standard_sources:
            sends.append(Send(f"scrape_{source}", state))
        elif source == "monster":
            sends.append(Send("scrape_monster", state))

    custom_sites: list[str] = state.preferences.get("custom_job_sites", [])
    if custom_sites:
        sends.append(Send("scrape_careers_page", state))

    logger.info(
        "pipeline_fan_out",
        active_sources=[s for s in active if s in standard_sources + ["monster"]],
        custom_sites_count=len(custom_sites),
        total_nodes=len(sends),
    )
    return sends


# ── Scraper nodes ─────────────────────────────────────────────────────────────

async def scrape_naukri(state: DiscoveryState) -> dict:
    from agent.scrapers.naukri import NaukriScraper
    pool = await _make_pool()
    try:
        scraper = NaukriScraper()
        queries = state.queries.get("naukri", [])
        logger.info("pipeline_step", step="scrape_naukri", status="started", query_count=len(queries))
        await _log(pool, state.pipeline_job_id, "info", "scrape_naukri",
                   f"Scraping Naukri ({len(queries)} queries)…", {"query_count": len(queries)})
        jobs = await scraper.safe_scrape(queries, state.preferences)
        logger.info("pipeline_step", step="scrape_naukri", status="complete", jobs_found=len(jobs))
        await _log(pool, state.pipeline_job_id, "info", "scrape_naukri",
                   f"Naukri complete — {len(jobs)} jobs found", {"jobs_found": len(jobs)})
    finally:
        await _close_pool(pool)
    return {"raw_jobs": jobs}


async def scrape_iimjobs(state: DiscoveryState) -> dict:
    from agent.scrapers.iimjobs import IimjobsScraper
    pool = await _make_pool()
    try:
        scraper = IimjobsScraper()
        queries = state.queries.get("iimjobs", [])
        logger.info("pipeline_step", step="scrape_iimjobs", status="started", query_count=len(queries))
        await _log(pool, state.pipeline_job_id, "info", "scrape_iimjobs",
                   f"Scraping IIMJobs ({len(queries)} queries)…", {"query_count": len(queries)})
        jobs = await scraper.safe_scrape(queries, state.preferences)
        logger.info("pipeline_step", step="scrape_iimjobs", status="complete", jobs_found=len(jobs))
        await _log(pool, state.pipeline_job_id, "info", "scrape_iimjobs",
                   f"IIMJobs complete — {len(jobs)} jobs found", {"jobs_found": len(jobs)})
    finally:
        await _close_pool(pool)
    return {"raw_jobs": jobs}


async def scrape_linkedin(state: DiscoveryState) -> dict:
    from agent.scrapers.linkedin import LinkedInScraper
    pool = await _make_pool()
    try:
        scraper = LinkedInScraper()
        queries = state.queries.get("naukri", [])[:3]
        logger.info("pipeline_step", step="scrape_linkedin", status="started", query_count=len(queries))
        await _log(pool, state.pipeline_job_id, "info", "scrape_linkedin",
                   f"Scraping LinkedIn ({len(queries)} queries)…", {"query_count": len(queries)})
        jobs = await scraper.safe_scrape(queries, state.preferences)
        logger.info("pipeline_step", step="scrape_linkedin", status="complete", jobs_found=len(jobs))
        await _log(pool, state.pipeline_job_id, "info", "scrape_linkedin",
                   f"LinkedIn complete — {len(jobs)} jobs found", {"jobs_found": len(jobs)})
    finally:
        await _close_pool(pool)
    return {"raw_jobs": jobs}


async def scrape_careers_page(state: DiscoveryState) -> dict:
    from agent.scrapers.careers_page import CareersPageScraper
    pool = await _make_pool()
    try:
        scraper = CareersPageScraper()
        custom_sites = state.preferences.get("custom_job_sites", [])
        logger.info("pipeline_step", step="scrape_careers_page", status="started", sites_count=len(custom_sites))
        await _log(pool, state.pipeline_job_id, "info", "scrape_careers_page",
                   f"Scraping careers pages ({len(custom_sites)} sites)…", {"sites_count": len(custom_sites)})
        jobs = await scraper.safe_scrape([], state.preferences)
        logger.info("pipeline_step", step="scrape_careers_page", status="complete", jobs_found=len(jobs))
        await _log(pool, state.pipeline_job_id, "info", "scrape_careers_page",
                   f"Careers pages complete — {len(jobs)} jobs found", {"jobs_found": len(jobs)})
    finally:
        await _close_pool(pool)
    return {"raw_jobs": jobs}


async def scrape_monster(state: DiscoveryState) -> dict:
    from agent.scrapers.monster import MonsterScraper
    pool = await _make_pool()
    try:
        scraper = MonsterScraper()
        queries = state.queries.get("naukri", [])[:3]
        logger.info("pipeline_step", step="scrape_monster", status="started", query_count=len(queries))
        await _log(pool, state.pipeline_job_id, "info", "scrape_monster",
                   f"Scraping Monster ({len(queries)} queries)…", {"query_count": len(queries)})
        jobs = await scraper.safe_scrape(queries, state.preferences)
        logger.info("pipeline_step", step="scrape_monster", status="complete", jobs_found=len(jobs))
        await _log(pool, state.pipeline_job_id, "info", "scrape_monster",
                   f"Monster complete — {len(jobs)} jobs found", {"jobs_found": len(jobs)})
    finally:
        await _close_pool(pool)
    return {"raw_jobs": jobs}


# ── Node: normalise_and_dedup ─────────────────────────────────────────────────

async def normalise_and_dedup(state: DiscoveryState) -> dict:
    """Deduplicate raw_jobs against scan history and within-batch fuzzy matching."""
    from agent.db import get_scan_history_urls
    from agent.normalise import deduplicate_batch

    logger.info("pipeline_step", step="normalise_and_dedup", status="started", raw_jobs=len(state.raw_jobs))

    pool = await _make_pool()
    try:
        seen_urls = await get_scan_history_urls(pool, state.candidate_id)

        await _log(pool, state.pipeline_job_id, "info", "normalise_and_dedup",
                   f"Deduplicating {len(state.raw_jobs)} raw jobs…",
                   {"raw_jobs": len(state.raw_jobs)})

        seen_keys: list[str] = []
        deduplicated = deduplicate_batch(state.raw_jobs, seen_urls=seen_urls, seen_keys=seen_keys)

        new_count = sum(1 for j in deduplicated if not j.is_duplicate)
        dedup_count = sum(1 for j in deduplicated if j.is_duplicate)

        await _log(pool, state.pipeline_job_id, "info", "normalise_and_dedup",
                   f"{new_count} new jobs · {dedup_count} duplicates removed",
                   {"new": new_count, "duplicates": dedup_count})
    finally:
        await _close_pool(pool)

    logger.info("pipeline_step", step="normalise_and_dedup", status="complete", new=new_count, duplicates=dedup_count)

    return {"deduplicated_jobs": deduplicated}


# ── Node: persist_jobs ────────────────────────────────────────────────────────

async def persist_jobs(state: DiscoveryState) -> dict:
    """Persist new jobs to the database."""
    pool = await _make_pool()

    try:
        from agent.db import bulk_insert_jobs, bulk_insert_scan_history, update_pipeline_run

        new_jobs = [j for j in state.deduplicated_jobs if not j.is_duplicate]
        logger.info("pipeline_step", step="persist_jobs", status="started", jobs_to_save=len(new_jobs))

        await _log(pool, state.pipeline_job_id, "info", "persist_jobs",
                   f"Saving {len(new_jobs)} jobs to database…", {"jobs_to_save": len(new_jobs)})

        job_dicts = [
            {
                "candidate_id": state.candidate_id,
                "pipeline_run_id": state.pipeline_run_id,
                "title": j.title,
                "company": j.company,
                "location": j.location,
                "jd_raw": j.jd_raw,
                "jd_text": j.jd_text,
                "source": j.source,
                "source_url": j.source_url,
                "application_url": j.application_url,
                "posted_at": j.posted_at,
            }
            for j in new_jobs
        ]
        job_ids = await bulk_insert_jobs(pool, job_dicts)

        scan_entries = [
            {
                "candidate_id": state.candidate_id,
                "url": j.source_url,
                "job_id": job_ids[i] if i < len(job_ids) else None,
            }
            for i, j in enumerate(state.deduplicated_jobs)
        ]
        await bulk_insert_scan_history(pool, scan_entries)

        deduped_count = sum(1 for j in state.deduplicated_jobs if j.is_duplicate)
        await update_pipeline_run(
            pool, state.pipeline_run_id,
            jobsDiscovered=len(new_jobs),
            jobsDeduplicated=deduped_count,
        )

        await _log(pool, state.pipeline_job_id, "info", "persist_jobs",
                   f"Saved {len(new_jobs)} jobs successfully", {"saved": len(new_jobs)})
    finally:
        await _close_pool(pool)

    logger.info("pipeline_step", step="persist_jobs", status="complete", saved=len(new_jobs))
    return {}


# ── Node: write_run_summary ───────────────────────────────────────────────────

async def write_run_summary(state: DiscoveryState) -> dict:
    """Mark the pipeline job and run as completed, write summary."""
    logger.info("pipeline_step", step="write_run_summary", status="started")
    pool = await _make_pool()

    try:
        from agent.db import update_pipeline_run, update_pipeline_job_status

        new_count     = sum(1 for j in state.deduplicated_jobs if not j.is_duplicate)
        dedup_count   = sum(1 for j in state.deduplicated_jobs if j.is_duplicate)
        error_sources = len(state.errors)
        unfetched     = 0

        summary = RunSummary(
            total_new=new_count,
            total_deduped=dedup_count,
            total_failed_sources=error_sources,
        )

        now = datetime.now(timezone.utc).isoformat()

        try:
            await update_pipeline_run(
                pool, state.pipeline_run_id,
                status="completed",
                completedAt=now,
                summary=summary.model_dump(),
            )
        except Exception as e:
            logger.error("write_run_summary_update_failed", error=str(e))
            await update_pipeline_run(pool, state.pipeline_run_id, status="completed", completedAt=now)

        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        # Auto-queue a fetch_jds job if any discovered jobs still have empty jd_raw
        from agent.db import count_jobs_with_empty_jd, queue_pipeline_job
        unfetched = await count_jobs_with_empty_jd(pool, state.candidate_id)
        if unfetched > 0:
            await queue_pipeline_job(pool, state.candidate_id, "fetch_jds")
            await _log(pool, state.pipeline_job_id, "info", "write_run_summary",
                       f"Pipeline complete — {new_count} jobs discovered. "
                       f"Queuing JD fetch for {unfetched} jobs…",
                       {"jobs_new": new_count, "jobs_deduped": dedup_count,
                        "pending_jd_fetch": unfetched})
        else:
            await _log(pool, state.pipeline_job_id, "info", "write_run_summary",
                       f"Pipeline complete — {new_count} jobs discovered",
                       {"jobs_new": new_count, "jobs_deduped": dedup_count})

        logger.info(
            "discovery_run_complete",
            jobs_new=new_count,
            jobs_deduped=dedup_count,
            sources_failed=error_sources,
            pending_jd_fetch=unfetched,
        )
    except Exception as e:
        logger.error("write_run_summary_failed", error=str(e))
        try:
            await update_pipeline_job_status(pool, state.pipeline_job_id, "failed", error=str(e))
        except Exception:
            pass
    finally:
        await _close_pool(pool)

    return {"run_summary": summary}


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_discovery_graph():
    graph = StateGraph(DiscoveryState)

    graph.add_node("build_queries", build_queries)
    graph.add_node("scrape_naukri", scrape_naukri)
    graph.add_node("scrape_iimjobs", scrape_iimjobs)
    graph.add_node("scrape_linkedin", scrape_linkedin)
    graph.add_node("scrape_careers_page", scrape_careers_page)
    graph.add_node("scrape_monster", scrape_monster)
    graph.add_node("normalise_and_dedup", normalise_and_dedup)
    graph.add_node("persist_jobs", persist_jobs)
    graph.add_node("write_run_summary", write_run_summary)

    graph.set_entry_point("build_queries")
    graph.add_conditional_edges("build_queries", fan_out)
    graph.add_edge("scrape_naukri", "normalise_and_dedup")
    graph.add_edge("scrape_iimjobs", "normalise_and_dedup")
    graph.add_edge("scrape_linkedin", "normalise_and_dedup")
    graph.add_edge("scrape_careers_page", "normalise_and_dedup")
    graph.add_edge("scrape_monster", "normalise_and_dedup")
    graph.add_edge("normalise_and_dedup", "persist_jobs")
    graph.add_edge("persist_jobs", "write_run_summary")
    graph.add_edge("write_run_summary", END)

    return graph.compile()


discovery_graph = build_discovery_graph()
