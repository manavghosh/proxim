"""Proxim agent polling daemon — polls Neon every 3s for queued pipeline jobs."""
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
    from agent.db import insert_pipeline_run
    from agent.graphs.discovery import discovery_graph
    from agent.models import DiscoveryState

    run_id = await insert_pipeline_run(pool, job['id'], job['candidate_id'])

    import json
    payload = job.get('payload') or {}
    if isinstance(payload, str):
        payload = json.loads(payload)

    state = DiscoveryState(
        candidate_id=str(job['candidate_id']),
        pipeline_job_id=str(job['id']),
        pipeline_run_id=run_id,
        preferences=payload.get('preferences', {}),
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
