"""Integration test for the resume builder graph — mocks all external calls."""
import json
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


FIXTURE_JOB_ID = str(uuid.uuid4())
FIXTURE_CANDIDATE_ID = str(uuid.uuid4())
FIXTURE_PIPELINE_JOB_ID = str(uuid.uuid4())

FIXTURE_PROFILE = {
    "name": "Test Candidate",
    "contact": {"email": "test@example.com"},
    "summary": "AI architect",
    "roles": [{"title": "VP of AI", "company": "TechCorp", "dates": "2020–2025", "bullets": ["Led AI"]}],
    "skills": ["Python"],
    "patents": [],
}

VALID_RESUME = {
    "summary": "Test summary",
    "roles": [{"title": "VP of AI", "company": "TechCorp", "dates": "2020 — 2025", "bullets": ["Led AI"]}],
    "skills": ["Python"],
    "proof_points": [],
    "coherence_ok": False,
}

VALID_COVER_LETTER = {
    "opening": "I am excited.",
    "body": "My experience matches.",
    "closing": "Looking forward.",
    "company_research_used": False,
}

KEYWORDS_18 = [
    "agentic-ai", "langgraph", "mcp-protocol", "llm-engineering", "python",
    "pytorch", "kubernetes", "mlops", "rag-pipeline", "fine-tuning",
    "prompt-engineering", "vector-database", "enterprise-ai", "ai-governance",
    "digital-transformation", "ai-strategy", "responsible-ai", "ai-architecture",
]


async def test_resume_builder_state_fields():
    from agent.models import ResumeBuilderState
    state = ResumeBuilderState(
        candidate_id=FIXTURE_CANDIDATE_ID,
        pipeline_job_id=FIXTURE_PIPELINE_JOB_ID,
        job_id=FIXTURE_JOB_ID,
    )
    assert state.self_review_attempt == 0
    assert state.review_passed is False
    assert state.keywords == []
    assert state.personalised_resume == ""
    assert state.version_id == ""
    assert state.error == ""


async def test_keyword_set_18_items():
    from agent.models import KeywordSet
    ks = KeywordSet(keywords=KEYWORDS_18)
    assert len(ks.keywords) == 18


async def test_resume_builder_state_stores_keywords():
    from agent.models import ResumeBuilderState
    state = ResumeBuilderState(
        candidate_id=FIXTURE_CANDIDATE_ID,
        pipeline_job_id=FIXTURE_PIPELINE_JOB_ID,
        job_id=FIXTURE_JOB_ID,
        keywords=KEYWORDS_18,
    )
    assert len(state.keywords) == 18


async def test_inject_keywords_is_applied_to_personalised_resume():
    from agent.models import PersonalisedResume
    from agent.resume_engine import inject_keywords
    pr = PersonalisedResume(
        summary="AI architect",
        roles=[],
        skills=["Python"],
        proof_points=[],
    )
    result = inject_keywords(pr, KEYWORDS_18)
    assert len(result.skills) > len(pr.skills)


async def test_archetype_registry_returns_5_archetypes():
    from agent.archetype_registry import ArchetypeRegistry
    registry = ArchetypeRegistry()
    archetypes = registry.all_archetypes()
    assert len(archetypes) == 5
    names = [a.name for a in archetypes]
    assert "Agentic Systems Architect" in names


async def test_archetype_confidence_fallback():
    from agent.archetype_registry import ArchetypeRegistry
    registry = ArchetypeRegistry()
    config = registry.get_archetype("Enterprise CAIO", confidence=0.4)
    assert config.name == "Agentic Systems Architect"
