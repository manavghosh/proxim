"""Proxim agent polling daemon — polls Neon every 3s for queued pipeline jobs."""
import asyncio
import signal
import structlog

logger = structlog.get_logger()
_stop_event = asyncio.Event()


def _handle_sigterm(*_):
    logger.info("sigterm_received", message="Shutting down daemon gracefully")
    _stop_event.set()


async def main() -> None:
    from agent.config import settings
    from agent.db import create_pool, close_pool, claim_pipeline_job

    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    logger.info("daemon_starting", polling_interval=settings.polling_interval_seconds)
    pool = await create_pool(settings.database_url)

    try:
        while not _stop_event.is_set():
            job = await claim_pipeline_job(pool)
            if job:
                logger.info("job_claimed", job_id=job['id'], job_type=job['job_type'])
                # Dispatch stub — will be replaced with graph invocation in Phase 3
                logger.info("job_dispatch_stub", message=f"would run {job['job_type']}")
            else:
                logger.debug("poll_idle", message="No jobs queued")
            await asyncio.sleep(settings.polling_interval_seconds)
    finally:
        await close_pool(pool)
        logger.info("daemon_stopped")


if __name__ == "__main__":
    asyncio.run(main())
