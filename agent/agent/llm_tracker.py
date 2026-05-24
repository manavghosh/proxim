"""LiteLLM cost-tracking via Langfuse OTel ingestion.

We do NOT use the langfuse Python SDK — it is broken on Python 3.14.
Instead, we configure LiteLLM's built-in "otel" callback and point the
OTLP exporter at Langfuse's native OTel endpoint:
  https://<host>/api/public/otel

Langfuse accepts standard OTLP spans and extracts LLM metadata
(model, tokens, cost) automatically from LiteLLM's span attributes.
"""
from __future__ import annotations

import base64
import os

import structlog

from agent.config import Settings

logger = structlog.get_logger()


def configure_langfuse(settings: Settings) -> None:
    """Point LiteLLM's OTel callback at Langfuse when credentials are present.

    Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL from
    Settings. No-op when keys are empty. Never raises — failures are logged and
    swallowed so the daemon always starts cleanly.
    """
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return

    try:
        import litellm

        host = (settings.langfuse_base_url or settings.langfuse_host or
                "https://us.cloud.langfuse.com").rstrip("/")
        otlp_endpoint = f"{host}/api/public/otel"

        # Langfuse OTel endpoint uses HTTP Basic auth: base64(pk:sk)
        creds = base64.b64encode(
            f"{settings.langfuse_public_key}:{settings.langfuse_secret_key}".encode()
        ).decode()

        # Set OTel env vars before LiteLLM initialises the exporter
        os.environ.setdefault("OTEL_EXPORTER_OTLP_ENDPOINT", otlp_endpoint)
        os.environ.setdefault(
            "OTEL_EXPORTER_OTLP_HEADERS",
            f"Authorization=Basic {creds}",
        )

        litellm.callbacks = ["otel"]
        logger.info(
            "langfuse_otel_configured",
            endpoint=otlp_endpoint,
            host=host,
        )
    except Exception as exc:
        logger.warning("langfuse_otel_configure_failed", error=str(exc))


def langfuse_metadata(
    agent_name: str,
    feature: str,
    job_id: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Build a LiteLLM metadata dict with trace-grouping keys.

    With the "otel" callback active, LiteLLM forwards these as span
    attributes. Langfuse reads them to group calls into traces and sessions.
    """
    meta: dict = {
        "generation_name": f"{agent_name}/{feature}",
        "tags": [agent_name, feature],
        "agent_name": agent_name,
        "feature": feature,
    }
    if run_id:
        meta["trace_id"] = run_id
    if job_id:
        meta["session_id"] = str(job_id)
    return meta
