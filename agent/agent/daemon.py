"""Proxim agent polling daemon — polls DB every 3s for queued pipeline jobs."""
import warnings
# langchain_core uses pydantic.v1 compat layer which emits a UserWarning on Python 3.14+.
# The daemon functions correctly — suppress the noise.
warnings.filterwarnings("ignore", message="Core Pydantic V1 functionality", category=UserWarning)

import asyncio
import signal
import structlog

logger = structlog.get_logger()
_stop_event = asyncio.Event()


def _handle_sigterm(*_):
    logger.info("sigterm_received", message="Shutting down daemon gracefully")
    _stop_event.set()


async def _dispatch_job(pool, job: dict) -> None:
    """Dispatch a pipeline job to the appropriate LangGraph graph."""
    from agent.db import insert_pipeline_run, get_candidate_preferences

    run_id = await insert_pipeline_run(pool, job['id'], job['candidate_id'])

    if job['job_type'] == 'fetch_jds':
        from agent.graphs.fetch_jds import fetch_jds_graph
        from agent.models import FetchJdsState

        logger.info("job_dispatching", job_id=job['id'], job_type='fetch_jds')

        state = FetchJdsState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
        )
        await fetch_jds_graph.ainvoke(state)

    else:
        from agent.graphs.discovery import discovery_graph
        from agent.models import DiscoveryState

        preferences = await get_candidate_preferences(pool, str(job['candidate_id']))
        enabled = preferences.get('enabled_sources', [])
        logger.info(
            "job_dispatching",
            job_id=job['id'],
            job_type=job['job_type'],
            enabled_sources=enabled if enabled else 'all (none selected)',
        )

        state = DiscoveryState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
            preferences=preferences,
        )

        logger.info("graph_invoking", graph="discovery", job_id=job['id'])
        await discovery_graph.ainvoke(state)
        logger.info("graph_complete", graph="discovery", job_id=job['id'])


async def main() -> None:
    from agent.config import settings
    from agent.db import create_pool, close_pool, claim_pipeline_job

    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    logger.info("daemon_starting", polling_interval_seconds=settings.polling_interval_seconds)
    pool = await create_pool(settings.database_url)

    try:
        while not _stop_event.is_set():
            job = await claim_pipeline_job(pool)
            if job:
                logger.info("job_claimed", job_id=job['id'], job_type=job['job_type'])
                await _dispatch_job(pool, job)
            else:
                logger.debug("poll_idle", message="No jobs queued")
            await asyncio.sleep(settings.polling_interval_seconds)
    finally:
        await close_pool(pool)
        logger.info("daemon_stopped")


if __name__ == "__main__":
    asyncio.run(main())
