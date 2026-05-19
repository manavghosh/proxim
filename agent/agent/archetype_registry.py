"""Archetype configuration registry for the Resume Builder Agent (F10)."""
from __future__ import annotations
from pydantic import BaseModel


class ArchetypeConfig(BaseModel):
    name:                   str
    section_order:          list[str]
    lead_proof_point_types: list[str]
    tone:                   str
    keywords_emphasis:      list[str] = []


_ARCHETYPES: list[ArchetypeConfig] = [
    ArchetypeConfig(
        name="Enterprise Chief AI Officer",
        section_order=["summary", "proof_points", "roles", "patents", "education", "skills"],
        lead_proof_point_types=["patent", "published_paper", "board_role"],
        tone="corporate",
        keywords_emphasis=["AI strategy", "enterprise AI", "digital transformation", "AI governance"],
    ),
    ArchetypeConfig(
        name="Startup CTO/VP",
        section_order=["proof_points", "roles", "skills", "patents", "education"],
        lead_proof_point_types=["oss_project", "speaking", "funding"],
        tone="startup",
        keywords_emphasis=["scale", "product-led", "0→1", "growth", "agentic", "LLM"],
    ),
    ArchetypeConfig(
        name="Agentic Systems Architect",
        section_order=["proof_points", "roles", "skills", "patents", "education"],
        lead_proof_point_types=["oss_project", "patent", "technical_blog"],
        tone="thought_leadership",
        keywords_emphasis=["LangGraph", "MCP", "agentic AI", "multi-agent", "LLM engineering"],
    ),
    ArchetypeConfig(
        name="GCC AI Practice Head",
        section_order=["summary", "roles", "proof_points", "education", "skills"],
        lead_proof_point_types=["published_paper", "speaking", "team_leadership"],
        tone="corporate",
        keywords_emphasis=["GCC", "AI practice", "offshore", "delivery", "CoE"],
    ),
    ArchetypeConfig(
        name="AI Thought Leader",
        section_order=["summary", "proof_points", "roles", "education", "skills"],
        lead_proof_point_types=["speaking", "published_paper", "podcast", "patent"],
        tone="thought_leadership",
        keywords_emphasis=["responsible AI", "AI ethics", "keynote", "advisor", "research"],
    ),
]

_DEFAULT_ARCHETYPE = "Agentic Systems Architect"
_BY_NAME: dict[str, ArchetypeConfig] = {a.name: a for a in _ARCHETYPES}
_DEFAULT: ArchetypeConfig = _BY_NAME[_DEFAULT_ARCHETYPE]


class ArchetypeRegistry:
    """Registry of all 5 archetypes with fallback logic per FR-002."""

    def get_archetype(self, name: str, confidence: float = 1.0) -> ArchetypeConfig:
        if confidence < 0.6:
            return _DEFAULT
        return _BY_NAME.get(name, _DEFAULT)

    def all_archetypes(self) -> list[ArchetypeConfig]:
        return list(_ARCHETYPES)
