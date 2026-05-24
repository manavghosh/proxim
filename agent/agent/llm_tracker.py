"""LiteLLM → Langfuse cost tracking via direct REST API.

We do NOT use the langfuse Python SDK — it is broken on Python 3.14.
Instead, a CustomLogger subclass posts generations straight to Langfuse's
/api/public/ingestion endpoint using httpx (already a project dependency).

No LiteLLM proxy server required. CustomLogger is part of the core library.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog

from agent.config import Settings

logger = structlog.get_logger()


class _LangfuseLogger:
    """Posts LiteLLM generations to Langfuse REST API.

    Registered via litellm.callbacks so it handles both sync and async
    completions. Failures are swallowed — cost tracking must never break
    the pipeline.
    """

    def __init__(self, endpoint: str, public_key: str, secret_key: str) -> None:
        self.endpoint = endpoint
        self._auth = (public_key, secret_key)

    # ── payload builder ────────────────────────────────────────────────────

    def _build_batch(
        self,
        kwargs: dict,
        response_obj: object,
        start_time: datetime,
        end_time: datetime,
    ) -> dict:
        usage = getattr(response_obj, "usage", None)
        meta: dict = kwargs.get("metadata") or {}
        cost: float = kwargs.get("response_cost") or 0.0
        trace_id: str = meta.get("trace_id") or str(uuid.uuid4())

        return {
            "batch": [
                {
                    "id": str(uuid.uuid4()),
                    "type": "generation-create",
                    "timestamp": _iso(start_time),
                    "body": {
                        "id": str(uuid.uuid4()),
                        "traceId": trace_id,
                        "name": meta.get("generation_name", kwargs.get("model", "llm")),
                        "model": kwargs.get("model", ""),
                        "startTime": _iso(start_time),
                        "endTime": _iso(end_time),
                        "usage": {
                            "input": _tokens(usage, "prompt_tokens"),
                            "output": _tokens(usage, "completion_tokens"),
                            "total": _tokens(usage, "total_tokens"),
                            "totalCost": cost,
                        },
                        "metadata": {
                            k: meta[k]
                            for k in ("agent_name", "feature", "session_id")
                            if k in meta
                        },
                    },
                }
            ]
        }

    # ── LiteLLM CustomLogger interface ────────────────────────────────────

    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        import httpx
        try:
            with httpx.Client(timeout=5.0) as client:
                client.post(
                    self.endpoint,
                    json=self._build_batch(kwargs, response_obj, start_time, end_time),
                    auth=self._auth,
                )
        except Exception as exc:
            logger.debug("langfuse_log_failed", error=str(exc))

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        import httpx
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    self.endpoint,
                    json=self._build_batch(kwargs, response_obj, start_time, end_time),
                    auth=self._auth,
                )
        except Exception as exc:
            logger.debug("langfuse_log_failed", error=str(exc))


# ── helpers ────────────────────────────────────────────────────────────────────

def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _tokens(usage: object | None, attr: str) -> int:
    return int(getattr(usage, attr, 0) or 0)


# ── public API ─────────────────────────────────────────────────────────────────

def configure_langfuse(settings: Settings) -> None:
    """Register Langfuse REST logger with LiteLLM when credentials are present.

    No-op when LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are empty.
    Never raises.
    """
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return

    try:
        import litellm

        host = (
            settings.langfuse_base_url
            or settings.langfuse_host
            or "https://us.cloud.langfuse.com"
        ).rstrip("/")
        endpoint = f"{host}/api/public/ingestion"

        cb = _LangfuseLogger(endpoint, settings.langfuse_public_key, settings.langfuse_secret_key)
        litellm.callbacks = [cb]
        logger.info("langfuse_configured", endpoint=endpoint)
    except Exception as exc:
        logger.warning("langfuse_configure_failed", error=str(exc))


def langfuse_metadata(
    agent_name: str,
    feature: str,
    job_id: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Build a LiteLLM metadata dict with trace-grouping keys for Langfuse."""
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
