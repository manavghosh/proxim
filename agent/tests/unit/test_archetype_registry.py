"""Tests for ArchetypeRegistry."""
import pytest

ARCHETYPE_NAMES = [
    "Enterprise Chief AI Officer",
    "Startup CTO/VP",
    "Agentic Systems Architect",
    "GCC AI Practice Head",
    "AI Thought Leader",
]
DEFAULT_ARCHETYPE = "Agentic Systems Architect"


def test_get_archetype_returns_correct_config_for_each_of_5_names():
    from agent.archetype_registry import ArchetypeRegistry
    registry = ArchetypeRegistry()
    for name in ARCHETYPE_NAMES:
        config = registry.get_archetype(name)
        assert config.name == name, f"Expected {name}, got {config.name}"


def test_unknown_archetype_falls_back_to_agentic_systems_architect():
    from agent.archetype_registry import ArchetypeRegistry
    registry = ArchetypeRegistry()
    config = registry.get_archetype("Unknown Archetype XYZ")
    assert config.name == DEFAULT_ARCHETYPE


def test_confidence_below_0_6_forces_agentic_systems_architect_default():
    from agent.archetype_registry import ArchetypeRegistry
    registry = ArchetypeRegistry()
    config = registry.get_archetype("Enterprise Chief AI Officer", confidence=0.5)
    assert config.name == DEFAULT_ARCHETYPE


def test_all_5_archetypes_have_non_empty_section_order_and_lead_proof_points():
    from agent.archetype_registry import ArchetypeRegistry
    registry = ArchetypeRegistry()
    for name in ARCHETYPE_NAMES:
        config = registry.get_archetype(name)
        assert len(config.section_order) > 0, f"{name} has empty section_order"
        assert len(config.lead_proof_point_types) > 0, f"{name} has empty lead_proof_point_types"


def test_archetype_names_are_exact_strings_matching_jobs_table():
    from agent.archetype_registry import ArchetypeRegistry
    registry = ArchetypeRegistry()
    for name in ARCHETYPE_NAMES:
        config = registry.get_archetype(name)
        assert config.name in ARCHETYPE_NAMES
