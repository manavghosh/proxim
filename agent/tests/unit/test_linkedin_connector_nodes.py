"""Unit tests for LinkedIn Connector LangGraph nodes (F5).

All external calls (Proxycurl, LiteLLM, DB) are mocked.
Tests follow RED → GREEN TDD: written before agent/nodes/linkedin_connector.py exists.
"""
from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from langchain_core.runnables import RunnableConfig

from agent.nodes.linkedin_connector import (
    LinkedInConnectorState,
    check_dnc_node,
    discover_contact_node,
    enrich_profile_node,
    generate_notes_node,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

CAND_ID    = "cand-0001"
JOB_ID     = "job--0001"
TARGET_ID  = "tgt--0001"
COMPANY    = "Acme Corp"
JOB_TITLE  = "Head of AI"
ARCHETYPE  = "Agentic Systems Architect"

SAMPLE_ENRICHMENT = {
    "full_name": "Alice Zhang",
    "headline": "CTO at Acme Corp",
    "summary": "10 years building AI systems",
    "experiences": [
        {
            "title": "CTO",
            "company": "Acme Corp",
            "starts_at": {"day": 1, "month": 3, "year": 2022},
            "ends_at": None,
        }
    ],
    "education": [
        {
            "degree_name": "MSc Computer Science",
            "school": {"name": "IIT Delhi"},
            "ends_at": {"year": 2014},
        }
    ],
}

SAMPLE_CONTACT = {
    "profile_url": "https://linkedin.com/in/alice-zhang",
    "name": "Alice Zhang",
    "title": "CTO",
}


def _base_state(**overrides) -> LinkedInConnectorState:
    base: LinkedInConnectorState = {
        "job_id":               JOB_ID,
        "candidate_id":         CAND_ID,
        "company":              COMPANY,
        "job_title":            JOB_TITLE,
        "archetype":            ARCHETYPE,
        "archetype_confidence": 0.9,
        "contact":              None,
        "enrichment":           None,
        "note_a":               None,
        "note_b":               None,
        "generation_attempts":  0,
        "outreach_target_id":   TARGET_ID,
        "status":               "pending",
        "error":                None,
    }
    base.update(overrides)
    return base


def _config(pool=None, proxycurl_api_key="test-px-key") -> RunnableConfig:
    return RunnableConfig(configurable={
        "pool": pool or AsyncMock(),
        "proxycurl_api_key": proxycurl_api_key,
    })


# ── DNC Node ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.get_candidate_preferences")
@patch("agent.nodes.linkedin_connector.update_outreach_target")
async def test_check_dnc_node_marks_skipped_dnc_when_company_in_list(
    mock_update, mock_prefs
):
    mock_prefs.return_value = {"do_not_contact_companies": ["Acme Corp", "Other Ltd"]}
    mock_update.return_value = None

    result = await check_dnc_node(_base_state(), _config())

    assert result["status"] == "skipped_dnc"
    mock_update.assert_called_once()
    update_kwargs = mock_update.call_args
    assert update_kwargs[1].get("status") == "skipped_dnc" or (
        len(update_kwargs[0]) >= 3 and update_kwargs[0][2] == "skipped_dnc"
        if len(update_kwargs[0]) >= 3 else
        any(v == "skipped_dnc" for v in update_kwargs[1].values())
    )


@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.get_candidate_preferences")
async def test_check_dnc_node_passes_through_when_company_not_in_list(mock_prefs):
    mock_prefs.return_value = {"do_not_contact_companies": ["Other Corp"]}

    result = await check_dnc_node(_base_state(), _config())

    assert result["status"] == "discovering"


@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.get_candidate_preferences")
async def test_check_dnc_node_passes_through_when_dnc_list_empty(mock_prefs):
    mock_prefs.return_value = {}

    result = await check_dnc_node(_base_state(), _config())

    assert result["status"] == "discovering"


# ── Discover Contact Node ─────────────────────────────────────────────────────

@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.proxycurl.search_employees")
@patch("agent.nodes.linkedin_connector.update_outreach_target")
async def test_discover_contact_node_searches_roles_in_priority_order(
    mock_update, mock_search
):
    """First search should be for CAIO — the highest priority title."""
    mock_search.return_value = SAMPLE_CONTACT  # match on first call
    mock_update.return_value = None

    result = await discover_contact_node(_base_state(status="discovering"), _config())

    first_call_role = mock_search.call_args_list[0][1].get("role") or mock_search.call_args_list[0][0][1]
    assert "CAIO" in first_call_role or "Chief AI" in first_call_role
    assert result["contact"] == SAMPLE_CONTACT
    assert result["status"] == "enriching"


@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.proxycurl.search_employees")
@patch("agent.nodes.linkedin_connector.update_outreach_target")
async def test_discover_contact_node_falls_back_to_hr_when_no_technical_contact(
    mock_update, mock_search
):
    """Returns None for all technical titles, but finds HR contact."""
    def _side_effect(company_name, role, api_key):
        if "HR" in role or "Talent" in role or "Recruiter" in role:
            return SAMPLE_CONTACT
        return None

    mock_search.side_effect = _side_effect
    mock_update.return_value = None

    result = await discover_contact_node(_base_state(status="discovering"), _config())

    assert result["contact"] is not None
    assert result["status"] == "enriching"


@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.proxycurl.search_employees")
@patch("agent.nodes.linkedin_connector.update_outreach_target")
async def test_discover_contact_node_marks_no_contact_found_when_all_roles_exhausted(
    mock_update, mock_search
):
    mock_search.return_value = None  # all searches return nothing
    mock_update.return_value = None

    result = await discover_contact_node(_base_state(status="discovering"), _config())

    assert result["status"] == "no_contact_found"
    assert result["contact"] is None


# ── Enrich Profile Node ───────────────────────────────────────────────────────

@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.proxycurl.enrich_profile")
@patch("agent.nodes.linkedin_connector.update_outreach_target")
async def test_enrich_profile_node_stores_enrichment_json(mock_update, mock_enrich):
    mock_enrich.return_value = SAMPLE_ENRICHMENT
    mock_update.return_value = None

    contact_with_url = {**SAMPLE_CONTACT, "profile_url": "https://linkedin.com/in/alice"}
    state = _base_state(status="enriching", contact=contact_with_url)

    result = await enrich_profile_node(state, _config())

    assert result["enrichment"] == SAMPLE_ENRICHMENT
    assert result["status"] == "generating"
    mock_update.assert_called_once()


# ── Generate Notes Node ───────────────────────────────────────────────────────

@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.update_outreach_target")
@patch("agent.nodes.linkedin_connector.litellm.completion")
async def test_generate_notes_node_produces_two_variants_under_300_chars(
    mock_llm, mock_update
):
    note_a = "Hi Alice — your 3-year tenure building AI infra at Acme caught my eye. I work on agentic systems and would love to connect."
    note_b = "Alice, IIT Delhi alum here, now building LangGraph-native agents. Your trajectory at Acme is impressive — would value a connection."

    mock_response = MagicMock()
    mock_response.choices[0].message.content = json.dumps({"note_a": note_a, "note_b": note_b})
    mock_llm.return_value = mock_response
    mock_update.return_value = None

    state = _base_state(status="generating", enrichment=SAMPLE_ENRICHMENT,
                        contact=SAMPLE_CONTACT)
    result = await generate_notes_node(state, _config())

    assert result["note_a"] == note_a
    assert result["note_b"] == note_b
    assert len(result["note_a"]) <= 300
    assert len(result["note_b"]) <= 300
    assert result["status"] == "notes_ready"


@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.update_outreach_target")
@patch("agent.nodes.linkedin_connector.litellm.completion")
async def test_generate_notes_node_retries_when_note_exceeds_300_chars(
    mock_llm, mock_update
):
    """First LLM call returns a note > 300 chars; second call returns valid notes."""
    too_long = "x" * 350
    good_a   = "Short note A — under 300 chars."
    good_b   = "Short note B — also under 300 chars."

    bad_response = MagicMock()
    bad_response.choices[0].message.content = json.dumps({"note_a": too_long, "note_b": good_b})

    good_response = MagicMock()
    good_response.choices[0].message.content = json.dumps({"note_a": good_a, "note_b": good_b})

    mock_llm.side_effect = [bad_response, good_response]
    mock_update.return_value = None

    state = _base_state(status="generating", enrichment=SAMPLE_ENRICHMENT,
                        contact=SAMPLE_CONTACT)
    result = await generate_notes_node(state, _config())

    assert mock_llm.call_count == 2, "should retry once after validation failure"
    assert result["note_a"] == good_a
    assert result["status"] == "notes_ready"


@pytest.mark.asyncio
@patch("agent.nodes.linkedin_connector.update_outreach_target")
@patch("agent.nodes.linkedin_connector.litellm.completion")
async def test_generate_notes_node_marks_failed_after_3_retries(mock_llm, mock_update):
    """All 3 LLM attempts return invalid notes → status becomes 'failed'."""
    too_long = "x" * 350
    bad_response = MagicMock()
    bad_response.choices[0].message.content = json.dumps(
        {"note_a": too_long, "note_b": too_long}
    )
    mock_llm.return_value = bad_response
    mock_update.return_value = None

    state = _base_state(status="generating", enrichment=SAMPLE_ENRICHMENT,
                        contact=SAMPLE_CONTACT)
    result = await generate_notes_node(state, _config())

    assert mock_llm.call_count == 3
    assert result["status"] == "failed"
