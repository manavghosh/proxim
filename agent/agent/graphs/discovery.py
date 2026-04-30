"""LangGraph discovery graph — fan-out scraping across job sources."""
from __future__ import annotations
from datetime import datetime, timezone
import structlog
from langgraph.graph import StateGraph, END
from langgraph.types import Send
from agent.models import DiscoveryState, NormalisedJob, RunSummary

logger = structlog.get_logger()


# ── Node: build_queries ───────────────────────────────────────────────────────

def build_queries(state: DiscoveryState) -> dict:
    """Generate 5-8 search queries per source from candidate preferences."""
    prefs = state.preferences
    seniority_levels: list[str] = prefs.get("seniority_levels", [])
    geo: list[str] = prefs.get("geographic_preference", [])

    base_queries = seniority_levels[:8] if seniority_levels else [
        "CAIO", "Chief AI Officer", "VP AI", "Head of AI",
        "Director AI", "AI Practice Head", "LangGraph engineer",
    ]

    # Add a location suffix to the first query if geo is available
    if geo and base_queries:
        location_hint = geo[0] if isinstance(geo, list) else geo
        base_queries = [f"{base_queries[0]} {location_hint}"] + base_queries[1:]

    queries = {
        "naukri": base_queries,
        "iimjobs": base_queries[:5],
    }

    return {"queries": queries}


# ── Node: fan_out ─────────────────────────────────────────────────────────────

def fan_out(state: DiscoveryState) -> list[Send]:
    """Return Send objects to run all scraper nodes in parallel."""
    sends = [
        Send("scrape_naukri", state),
        Send("scrape_iimjobs", state),
        Send("scrape_linkedin", state),
    ]
    # Only scrape target company careers pages if URLs are configured
    if state.preferences.get("target_companies_with_urls"):
        sends.append(Send("scrape_careers_page", state))
    return sends


# ── Scraper nodes ─────────────────────────────────────────────────────────────

async def scrape_naukri(state: DiscoveryState) -> dict:
    from agent.scrapers.naukri import NaukriScraper
    scraper = NaukriScraper()
    queries = state.queries.get("naukri", [])
    jobs = await scraper.safe_scrape(queries, state.preferences)
    logger.info("scrape_complete", source="naukri", jobs_found=len(jobs))
    return {"raw_jobs": jobs}


async def scrape_iimjobs(state: DiscoveryState) -> dict:
    from agent.scrapers.iimjobs import IimjobsScraper
    scraper = IimjobsScraper()
    queries = state.queries.get("iimjobs", [])
    jobs = await scraper.safe_scrape(queries, state.preferences)
    logger.info("scrape_complete", source="iimjobs", jobs_found=len(jobs))
    return {"raw_jobs": jobs}


async def scrape_linkedin(state: DiscoveryState) -> dict:
    from agent.scrapers.linkedin import LinkedInScraper
    scraper = LinkedInScraper()
    queries = state.queries.get("naukri", [])[:3]  # reuse top 3 queries
    jobs = await scraper.safe_scrape(queries, state.preferences)
    logger.info("scrape_complete", source="linkedin", jobs_found=len(jobs))
    return {"raw_jobs": jobs}


async def scrape_careers_page(state: DiscoveryState) -> dict:
    from agent.scrapers.careers_page import CareersPageScraper
    scraper = CareersPageScraper()
    jobs = await scraper.safe_scrape([], state.preferences)
    logger.info("scrape_complete", source="careers_page", jobs_found=len(jobs))
    return {"raw_jobs": jobs}


# ── Node: normalise_and_dedup (stub — replaced in Phase 4) ───────────────────

async def normalise_and_dedup(state: DiscoveryState) -> dict:
    """Deduplicate raw_jobs against scan history and within-batch fuzzy matching."""
    from agent.config import settings
    import asyncpg
    from agent.db import get_scan_history_urls
    from agent.normalise import deduplicate_batch

    pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=3)
    try:
        seen_urls = await get_scan_history_urls(pool, state.candidate_id)
    finally:
        await pool.close()

    seen_keys: list[str] = []
    deduplicated = deduplicate_batch(state.raw_jobs, seen_urls=seen_urls, seen_keys=seen_keys)

    new_count = sum(1 for j in deduplicated if not j.is_duplicate)
    dedup_count = sum(1 for j in deduplicated if j.is_duplicate)
    logger.info("dedup_complete", new=new_count, duplicates=dedup_count)

    return {"deduplicated_jobs": deduplicated}


# ── Node: persist_jobs ────────────────────────────────────────────────────────

async def persist_jobs(state: DiscoveryState) -> dict:
    """Persist new jobs to the database."""
    from agent.config import settings
    import asyncpg
    pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=3)

    try:
        from agent.db import bulk_insert_jobs, bulk_insert_scan_history, update_pipeline_run

        new_jobs = [j for j in state.deduplicated_jobs if not j.is_duplicate]
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
    finally:
        await pool.close()

    return {}


# ── Node: write_run_summary ───────────────────────────────────────────────────

async def write_run_summary(state: DiscoveryState) -> dict:
    """Mark the pipeline job and run as completed, write summary."""
    from datetime import datetime, timezone
    from agent.config import settings
    import asyncpg
    pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=3)

    try:
        from agent.db import update_pipeline_run, update_pipeline_job_status

        new_count = sum(1 for j in state.deduplicated_jobs if not j.is_duplicate)
        dedup_count = sum(1 for j in state.deduplicated_jobs if j.is_duplicate)
        error_sources = len(state.errors)

        summary = RunSummary(
            total_new=new_count,
            total_deduped=dedup_count,
            total_failed_sources=error_sources,
        )

        now = datetime.now(timezone.utc)
        await update_pipeline_run(
            pool, state.pipeline_run_id,
            status="completed",
            completedAt=now,
            summary=summary.model_dump(),
        )
        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        logger.info(
            "discovery_run_complete",
            jobs_new=new_count,
            jobs_deduped=dedup_count,
            sources_failed=error_sources,
        )
    finally:
        await pool.close()

    return {"run_summary": summary}


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_discovery_graph():
    graph = StateGraph(DiscoveryState)

    graph.add_node("build_queries", build_queries)
    graph.add_node("scrape_naukri", scrape_naukri)
    graph.add_node("scrape_iimjobs", scrape_iimjobs)
    graph.add_node("scrape_linkedin", scrape_linkedin)
    graph.add_node("scrape_careers_page", scrape_careers_page)
    graph.add_node("normalise_and_dedup", normalise_and_dedup)
    graph.add_node("persist_jobs", persist_jobs)
    graph.add_node("write_run_summary", write_run_summary)

    graph.set_entry_point("build_queries")
    graph.add_conditional_edges("build_queries", fan_out)
    graph.add_edge("scrape_naukri", "normalise_and_dedup")
    graph.add_edge("scrape_iimjobs", "normalise_and_dedup")
    graph.add_edge("scrape_linkedin", "normalise_and_dedup")
    graph.add_edge("scrape_careers_page", "normalise_and_dedup")
    graph.add_edge("normalise_and_dedup", "persist_jobs")
    graph.add_edge("persist_jobs", "write_run_summary")
    graph.add_edge("write_run_summary", END)

    return graph.compile()


discovery_graph = build_discovery_graph()
