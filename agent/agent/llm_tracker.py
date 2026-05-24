"""LiteLLM cost-tracking metadata helpers.

Langfuse SDK is incompatible with Python 3.14 and has been removed as a
dependency. Cost and trace data flows through OTel (see telemetry.py).
This module is kept so call-sites (scoring_engine, resume_engine, etc.) that
pass metadata= to litellm.acompletion() continue to work unchanged.
"""
from __future__ import annotations

from agent.config import Settings


def configure_langfuse(_settings: Settings) -> None:
    """No-op: Langfuse removed — see module docstring."""


def langfuse_metadata(
    agent_name: str,
    feature: str,
    job_id: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Build a LiteLLM metadata dict used for trace grouping.

    Keys are forwarded to LiteLLM as-is; without a Langfuse callback active
    they are silently ignored. Kept so scoring_engine / resume_engine call-sites
    don't need to change.
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
