"""Tests for Resume Builder Pydantic models."""
import pytest
from pydantic import ValidationError


def test_keyword_set_accepts_15_unique_keywords():
    from agent.models import KeywordSet
    kws = [f"keyword{i}" for i in range(15)]
    ks = KeywordSet(keywords=kws)
    assert len(ks.keywords) == 15


def test_keyword_set_rejects_fewer_than_15():
    from agent.models import KeywordSet
    with pytest.raises(ValidationError):
        KeywordSet(keywords=["only", "ten", "words", "here", "not", "enough", "to", "pass", "the", "check"])


def test_keyword_set_deduplicates_case_insensitive():
    from agent.models import KeywordSet
    kws = ["Python", "python", "PYTHON"] + [f"keyword{i}" for i in range(14)]
    ks = KeywordSet(keywords=kws)
    assert "python" in ks.keywords
    assert len([k for k in ks.keywords if k == "python"]) == 1


def test_keyword_set_trims_whitespace():
    from agent.models import KeywordSet
    kws = ["  python  ", " java ", "go"] + [f"keyword{i}" for i in range(13)]
    ks = KeywordSet(keywords=kws)
    assert "python" in ks.keywords
    assert "java" in ks.keywords


def test_resume_builder_state_defaults_to_zero_retry_attempt():
    from agent.models import ResumeBuilderState
    state = ResumeBuilderState(candidate_id="c1", pipeline_job_id="p1")
    assert state.self_review_attempt == 0
    assert state.review_passed is False
    assert state.error == ""
