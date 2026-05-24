"""Unit tests for llm_tracker.configure_langfuse (F8 US1)."""
from __future__ import annotations

import os
from unittest.mock import patch


class _FakeSettings:
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = ""
    langfuse_base_url: str = ""


def test_configure_langfuse_is_noop_when_keys_empty():
    """configure_langfuse returns immediately with no side effects when keys are empty."""
    import litellm

    original_callbacks = list(litellm.callbacks)

    settings = _FakeSettings()
    settings.langfuse_public_key = ""
    settings.langfuse_secret_key = ""

    from agent.llm_tracker import configure_langfuse
    configure_langfuse(settings)

    assert litellm.callbacks == original_callbacks, (
        "litellm.callbacks must not be modified when langfuse keys are empty"
    )


def test_configure_langfuse_does_not_raise_on_import_error():
    """configure_langfuse catches exceptions gracefully — bad credentials must not crash daemon."""
    settings = _FakeSettings()
    settings.langfuse_public_key = "pk-lf-test"
    settings.langfuse_secret_key = "sk-lf-test"
    settings.langfuse_base_url = "https://us.cloud.langfuse.com"

    import litellm
    with patch.object(litellm, "__setattr__", side_effect=Exception("litellm internals exploded")):
        from agent.llm_tracker import configure_langfuse
        configure_langfuse(settings)  # must not raise


def test_configure_langfuse_sets_langfuse_otel_host_not_langfuse_host():
    """langfuse_otel callback reads LANGFUSE_OTEL_HOST, not LANGFUSE_HOST."""
    settings = _FakeSettings()
    settings.langfuse_public_key = "pk-lf-test"
    settings.langfuse_secret_key = "sk-lf-test"
    settings.langfuse_base_url = "https://us.cloud.langfuse.com"

    # Remove both vars so setdefault() actually writes
    env_clean = {k: v for k, v in os.environ.items() if k not in ("LANGFUSE_OTEL_HOST", "LANGFUSE_HOST")}
    with patch.dict(os.environ, env_clean, clear=True):
        from agent.llm_tracker import configure_langfuse
        configure_langfuse(settings)
        assert os.environ.get("LANGFUSE_OTEL_HOST") == "https://us.cloud.langfuse.com", (
            "LANGFUSE_OTEL_HOST must be set for the langfuse_otel callback to reach US cloud"
        )
        assert "LANGFUSE_HOST" not in os.environ, (
            "LANGFUSE_HOST is the old SDK var and must not be set by configure_langfuse"
        )


def test_langfuse_metadata_omits_trace_id_when_run_id_none():
    """trace_id must be absent when run_id is None — empty string groups unrelated calls."""
    from agent.llm_tracker import langfuse_metadata
    meta = langfuse_metadata("scoring_engine", "scoring", job_id="42", run_id=None)
    assert "trace_id" not in meta, (
        "trace_id must not be present when run_id is None; empty string pollutes trace grouping"
    )


def test_langfuse_metadata_omits_session_id_when_job_id_none():
    """session_id must be absent when job_id is None — empty string is a meaningless session."""
    from agent.llm_tracker import langfuse_metadata
    meta = langfuse_metadata("scoring_engine", "scoring", job_id=None, run_id="run-abc")
    assert "session_id" not in meta, (
        "session_id must not be present when job_id is None"
    )


def test_langfuse_metadata_includes_trace_id_and_session_id_when_provided():
    """When both run_id and job_id are given, trace_id and session_id must be present."""
    from agent.llm_tracker import langfuse_metadata
    meta = langfuse_metadata("resume_engine", "resume", job_id="99", run_id="run-xyz")
    assert meta["trace_id"] == "run-xyz"
    assert meta["session_id"] == "99"
    assert meta["generation_name"] == "resume_engine/resume"
    assert "resume_engine" in meta["tags"]
    assert "resume" in meta["tags"]
