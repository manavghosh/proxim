"""Tests for resume_engine.py — mocks LiteLLM calls."""
import json
import pytest
from unittest.mock import patch, MagicMock


FIXTURE_PROFILE = {
    "name": "Manav Ghosh",
    "contact": {"email": "m@example.com"},
    "summary": "AI architect",
    "roles": [{"title": "VP of AI", "company": "TechCorp", "dates": "2020–2025", "bullets": ["Led AI platform"]}],
    "skills": ["Python", "LangGraph"],
    "patents": [],
    "projects": [],
}

FIXTURE_JOB = {
    "id": "job-001",
    "title": "Head of AI",
    "company": "Acme",
    "jd_raw": "We need an AI leader with LangGraph and Python skills to lead our ML platform.",
}

FIXTURE_ARCHETYPE_CONFIG = MagicMock()
FIXTURE_ARCHETYPE_CONFIG.name = "Agentic Systems Architect"
FIXTURE_ARCHETYPE_CONFIG.section_order = ["summary", "proof_points", "roles", "skills"]
FIXTURE_ARCHETYPE_CONFIG.lead_proof_point_types = ["oss_project", "patent"]
FIXTURE_ARCHETYPE_CONFIG.tone = "thought_leadership"
FIXTURE_ARCHETYPE_CONFIG.keywords_emphasis = ["LangGraph", "agentic"]

VALID_RESUME_JSON = {
    "summary": "Experienced AI architect with deep LangGraph expertise.",
    "roles": [{"title": "VP of AI", "company": "TechCorp", "start_date": "2020", "end_date": "2025", "bullets": ["Led AI platform"]}],
    "skills": ["Python", "LangGraph"],
    "proof_points": ["Open-sourced agentic framework"],
    "coherence_ok": False,
}

VALID_COVER_LETTER_JSON = {
    "opening": "I am thrilled to apply.",
    "body": "My experience aligns perfectly.",
    "closing": "Looking forward to connecting.",
    "company_research_used": False,
}


def _mock_litellm_response(json_data: dict):
    mock = MagicMock()
    mock.choices[0].message.content = json.dumps(json_data)
    return mock


def _make_settings():
    s = MagicMock()
    s.llm_provider = "anthropic"
    s.llm_model = "claude-sonnet-4-6"
    s.anthropic_api_key = "test-key"
    s.gemini_api_key = ""
    return s


def test_personalise_resume_returns_personalised_resume_model():
    with patch("litellm.completion", return_value=_mock_litellm_response(VALID_RESUME_JSON)):
        from agent.resume_engine import personalise_resume
        result = personalise_resume(FIXTURE_JOB, FIXTURE_PROFILE, FIXTURE_ARCHETYPE_CONFIG, ["LangGraph"], _make_settings())
        assert result.summary == VALID_RESUME_JSON["summary"]
        assert len(result.roles) == 1


def test_personalise_resume_preserves_verbatim_titles_companies_dates():
    with patch("litellm.completion", return_value=_mock_litellm_response(VALID_RESUME_JSON)):
        from agent.resume_engine import personalise_resume
        result = personalise_resume(FIXTURE_JOB, FIXTURE_PROFILE, FIXTURE_ARCHETYPE_CONFIG, [], _make_settings())
        assert result.roles[0].title == "VP of AI"
        assert result.roles[0].company == "TechCorp"


def test_self_review_returns_coherence_ok_true_on_valid_output():
    mock_resp = _mock_litellm_response({"coherence_ok": True, "feedback": "All good"})
    with patch("litellm.completion", return_value=mock_resp):
        from agent.resume_engine import self_review
        from agent.models import PersonalisedResume, RoleSection
        pr = PersonalisedResume(**VALID_RESUME_JSON)
        ok, feedback = self_review(FIXTURE_JOB, pr, FIXTURE_PROFILE, _make_settings())
        assert ok is True


def test_self_review_returns_coherence_ok_false_on_fabricated_claim():
    mock_resp = _mock_litellm_response({"coherence_ok": False, "feedback": "Role title inflated"})
    with patch("litellm.completion", return_value=mock_resp):
        from agent.resume_engine import self_review
        from agent.models import PersonalisedResume
        pr = PersonalisedResume(**VALID_RESUME_JSON)
        ok, feedback = self_review(FIXTURE_JOB, pr, FIXTURE_PROFILE, _make_settings())
        assert ok is False
        assert "inflated" in feedback


def test_generate_cover_letter_returns_cover_letter_content():
    with patch("litellm.completion", return_value=_mock_litellm_response(VALID_COVER_LETTER_JSON)):
        from agent.resume_engine import generate_cover_letter
        result = generate_cover_letter(FIXTURE_JOB, FIXTURE_PROFILE, FIXTURE_ARCHETYPE_CONFIG, _make_settings())
        assert result.opening == VALID_COVER_LETTER_JSON["opening"]
        assert result.company_research_used is False
