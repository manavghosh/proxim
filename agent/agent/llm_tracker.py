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
        trace_id: str = meta.get("langfuse_trace_id") or meta.get("trace_id") or str(uuid.uuid4())
        agent_name: str = meta.get("agent_name", "proxim")
        job_id: str | None = meta.get("session_id")  # set by langfuse_metadata when job_id provided

        # Extract input/output so Langfuse shows the actual prompts and completions.
        input_messages = kwargs.get("messages") or []
        output_text: str = ""
        try:
            choices = getattr(response_obj, "choices", [])
            if choices:
                output_text = getattr(choices[0].message, "content", "") or ""
        except Exception:
            pass

        # trace-create ensures Langfuse has a named trace with sessionId set.
        # Sending it every time is safe — Langfuse uses upsert semantics on trace ID.
        trace_event = {
            "id": str(uuid.uuid4()),
            "type": "trace-create",
            "timestamp": _iso(start_time),
            "body": {
                "id": trace_id,
                "name": agent_name,
                "sessionId": job_id,
                "tags": meta.get("tags", [agent_name]),
                "metadata": {
                    k: meta[k]
                    for k in ("agent_name", "feature")
                    if k in meta
                },
            },
        }

        generation_event = {
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
                "input": input_messages,
                "output": output_text,
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

        return {"batch": [trace_event, generation_event]}

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


def configure_langsmith_litellm(settings: Settings) -> None:
    """Register LangSmith as a LiteLLM success callback so LLM calls appear
    inside LangSmith traces alongside graph-level LangGraph spans.

    No-op when LANGSMITH_TRACING is false or LANGSMITH_API_KEY is empty.
    Never raises.
    """
    if not settings.langsmith_tracing or not settings.langsmith_api_key:
        return

    try:
        import litellm

        if "langsmith" not in litellm.success_callback:
            litellm.success_callback.append("langsmith")
        logger.info("langsmith_litellm_configured")
    except Exception as exc:
        logger.warning("langsmith_litellm_configure_failed", error=str(exc))


def langfuse_metadata(
    agent_name: str,
    feature: str,
    job_id: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Build a LiteLLM metadata dict with trace-grouping keys for Langfuse and LangSmith."""
    generation_name = f"{agent_name}/{feature}"
    meta: dict = {
        "generation_name": generation_name,
        "run_name": generation_name,          # LangSmith uses run_name for display
        "tags": [agent_name, feature],
        "agent_name": agent_name,
        "feature": feature,
    }
    if run_id:
        meta["langfuse_trace_id"] = run_id
    if job_id:
        meta["session_id"] = str(job_id)
    return meta
