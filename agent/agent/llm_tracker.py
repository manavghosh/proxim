"""Langfuse LLM cost tracking integration (F8 US1).

Registers litellm.callbacks = ["langfuse_otel"] so every litellm.completion() /
litellm.acompletion() call is tracked in Langfuse with token counts, cost (USD),
and latency. Groups calls from the same pipeline run into a single Langfuse trace
via the `trace_id` metadata key.

Design: fire-and-forget — any failure here must never propagate to the pipeline.
"""
from __future__ import annotations

import os
import structlog

from agent.config import Settings

logger = structlog.get_logger()


def configure_langfuse(settings: Settings) -> None:
    """Register the Langfuse LiteLLM callback if credentials are configured.

    Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_HOST (or
    LANGFUSE_BASE_URL) from Settings. No-op when keys are empty. Catches all
    errors so the daemon always starts cleanly.
    """
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return

    try:
        import litellm

        # LiteLLM's langfuse_otel callback reads these env vars directly.
        # Set them now so they're available before any completion() call.
        os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
        os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)

        # LANGFUSE_HOST is read by LiteLLM's "langfuse" callback.
        # Required for US cloud (us.cloud.langfuse.com); omit for EU default.
        host = settings.langfuse_host or settings.langfuse_base_url
        if host:
            os.environ.setdefault("LANGFUSE_HOST", host)

        litellm.callbacks = ["langfuse"]
        logger.info("langfuse_configured", host=host or "https://cloud.langfuse.com")
    except Exception as exc:
        logger.warning("langfuse_configure_failed", error=str(exc))


def langfuse_metadata(
    agent_name: str,
    feature: str,
    job_id: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Build a LiteLLM metadata dict with Langfuse trace-grouping keys.

    Passing `trace_id=run_id` groups all LLM calls from the same pipeline run
    into a single Langfuse trace, making cost-per-run visible at a glance.
    """
    meta: dict = {
        "generation_name": f"{agent_name}/{feature}",
        "tags": [agent_name, feature],
        # Custom fields visible as metadata in Langfuse
        "agent_name": agent_name,
        "feature": feature,
    }
    # Only set trace_id / session_id when values are present — an empty string would
    # incorrectly merge all untraced calls into a single phantom trace/session.
    if run_id:
        meta["trace_id"] = run_id
    if job_id:
        meta["session_id"] = str(job_id)
    return meta
