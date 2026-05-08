"""Tests for extract_keywords and inject_keywords in resume_engine.py."""
import json
import pytest
from unittest.mock import MagicMock


def _mock_litellm(keywords: list[str]):
    mock = MagicMock()
    mock.choices[0].message.content = json.dumps({"keywords": keywords})
    return mock


def _make_settings():
    s = MagicMock()
    s.llm_provider = "anthropic"
    s.llm_model = "claude-sonnet-4-6"
    s.anthropic_api_key = "test-key"
    s.gemini_api_key = ""
    return s


FIXTURE_JD = "We need an AI architect with LangGraph, Python, MCP, agentic AI, LLM engineering expertise."

KWS_18 = [
    "agentic-ai", "langgraph", "mcp-protocol", "llm-engineering", "python",
    "pytorch", "kubernetes", "mlops", "rag-pipeline", "fine-tuning",
    "prompt-engineering", "vector-database", "enterprise-ai", "ai-governance",
    "digital-transformation", "ai-strategy", "responsible-ai", "ai-architecture",
]
KWS_10 = ["agentic", "python", "java", "cloud", "data", "ml", "ops", "sre", "devops", "ci"]  # too few


def test_extract_keywords_returns_keyword_set_with_15_to_20_items():
    from unittest.mock import patch
    with patch("litellm.completion", return_value=_mock_litellm(KWS_18)):
        from agent.resume_engine import extract_keywords
        result = extract_keywords(FIXTURE_JD, _make_settings())
        assert 15 <= len(result.keywords) <= 20


def test_extract_keywords_deduplicates_case_insensitively():
    from unittest.mock import patch
    duped = ["Python", "python", "PYTHON"] + [f"kw_{i}" for i in range(15)]
    with patch("litellm.completion", return_value=_mock_litellm(duped)):
        from agent.resume_engine import extract_keywords
        result = extract_keywords(FIXTURE_JD, _make_settings())
        lowers = [k.lower() for k in result.keywords]
        assert lowers.count("python") == 1


def test_extract_keywords_rejects_llm_response_with_fewer_than_15():
    from unittest.mock import patch
    with patch("litellm.completion", return_value=_mock_litellm(KWS_10)):
        from agent.resume_engine import extract_keywords
        with pytest.raises(ValueError):
            extract_keywords(FIXTURE_JD, _make_settings())


def test_inject_keywords_does_not_alter_job_title_or_company():
    from agent.models import PersonalisedResume, RoleSection
    from agent.resume_engine import inject_keywords
    pr = PersonalisedResume(
        summary="AI architect",
        roles=[RoleSection(title="VP of AI", company="TechCorp", start_date="2020", end_date="2025", bullets=["Led platform"])],
        skills=["Python"],
        proof_points=[],
    )
    kws = KWS_18
    result = inject_keywords(pr, kws)
    # Titles and companies unchanged
    assert result.roles[0].title == "VP of AI"
    assert result.roles[0].company == "TechCorp"


def test_inject_keywords_each_keyword_appears_at_most_3_times():
    from agent.models import PersonalisedResume
    from agent.resume_engine import inject_keywords
    pr = PersonalisedResume(summary="AI architect", roles=[], skills=[], proof_points=[])
    result = inject_keywords(pr, KWS_18)
    full_text = (result.summary + " " + " ".join(result.skills)).lower()
    for kw in result.skills:
        assert full_text.count(kw.lower()) <= 3


def test_inject_keywords_result_contains_at_least_15_keywords():
    from agent.models import PersonalisedResume
    from agent.resume_engine import inject_keywords
    pr = PersonalisedResume(summary="AI architect", roles=[], skills=[], proof_points=[])
    result = inject_keywords(pr, KWS_18)
    full_text = (result.summary + " " + " ".join(result.skills)).lower()
    found = [kw for kw in KWS_18 if kw.lower() in full_text]
    assert len(found) >= 15
