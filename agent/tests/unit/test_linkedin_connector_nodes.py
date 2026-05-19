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
        "job_url":              "",
        "candidate_id":         CAND_ID,
        "candidate_name":       "Test Candidate",
        "company":              COMPANY,
        "job_title":            JOB_TITLE,
        "archetype":            ARCHETYPE,
        "archetype_confidence": 0.9,
        "contact":              None,
        "enrichment":           None,
        "person_research":      "",
        "company_research":     "",
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
@patch("agent.nodes.linkedin_connector.determine_target_roles", new=AsyncMock(return_value=["Head of Product", "VP Engineering", "Recruiter"]))
async def test_discover_contact_node_uses_llm_determined_roles(
    mock_update, mock_search
):
    """discover_contact_node uses LLM-determined roles, stops on first match."""
    mock_search.return_value = SAMPLE_CONTACT  # match on first call
    mock_update.return_value = None

    result = await discover_contact_node(_base_state(status="discovering"), _config())

    # Should have searched using the first LLM-determined role
    first_call_role = mock_search.call_args_list[0][1].get("role") or mock_search.call_args_list[0][0][1]
    assert first_call_role == "Head of Product"
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


# ── determine_target_roles ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_determine_target_roles_returns_llm_roles():
    """LLM response is parsed into a list of role strings."""
    from agent.nodes.linkedin_connector import determine_target_roles

    mock_resp = MagicMock()
    mock_resp.choices[0].message.content = '{"roles": ["VP of AI", "CTO", "Head of Data"]}'

    with patch("agent.nodes.linkedin_connector.litellm.acompletion", new=AsyncMock(return_value=mock_resp)):
        roles = await determine_target_roles("AI Architect", "Acme Corp")

    assert roles == ["VP of AI", "CTO", "Head of Data"]


@pytest.mark.asyncio
async def test_determine_target_roles_falls_back_on_llm_failure():
    """Falls back to sensible defaults when LLM call raises an exception."""
    from agent.nodes.linkedin_connector import determine_target_roles

    with patch("agent.nodes.linkedin_connector.litellm.acompletion", new=AsyncMock(side_effect=Exception("timeout"))):
        roles = await determine_target_roles("AI Architect", "Acme Corp")

    # Fallback must be generic — no AI-specific hardcoding
    assert len(roles) >= 3
    assert any("Hiring Manager" in r or "Talent Acquisition" in r or "Recruiter" in r for r in roles)


@pytest.mark.asyncio
async def test_determine_target_roles_caps_at_five():
    """Never returns more than 5 roles regardless of LLM output."""
    from agent.nodes.linkedin_connector import determine_target_roles

    mock_resp = MagicMock()
    mock_resp.choices[0].message.content = (
        '{"roles": ["R1","R2","R3","R4","R5","R6","R7"]}'
    )

    with patch("agent.nodes.linkedin_connector.litellm.acompletion", new=AsyncMock(return_value=mock_resp)):
        roles = await determine_target_roles("AI Architect", "Acme")

    assert len(roles) <= 5


# ── Research Contact Node ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_research_contact_node_populates_state():
    """research_contact_node adds person_research and company_research to state."""
    from agent.nodes.linkedin_connector import research_contact_node
    from langchain_core.runnables import RunnableConfig

    config = RunnableConfig(configurable={"pool": None, "proxycurl_api_key": "key"})
    state = {
        "contact": {"name": "Jane Doe"},
        "company": "Acme Corp",
        "candidate_id": "cand-1",
        "person_research": "",
        "company_research": "",
    }

    with (
        patch("agent.proxycurl.research_person", new=AsyncMock(return_value="• Jane's recent talk on AI")),
        patch("agent.proxycurl.research_company", new=AsyncMock(return_value="• Acme launches AI product")),
    ):
        result = await research_contact_node(state, config)

    assert result["person_research"] == "• Jane's recent talk on AI"
    assert result["company_research"] == "• Acme launches AI product"


@pytest.mark.asyncio
async def test_research_contact_node_handles_empty_results():
    """research_contact_node returns empty strings when Exa finds nothing."""
    from agent.nodes.linkedin_connector import research_contact_node
    from langchain_core.runnables import RunnableConfig

    config = RunnableConfig(configurable={"pool": None, "proxycurl_api_key": "key"})
    state  = {"contact": {"name": "Unknown"}, "company": "X Corp",
               "candidate_id": "c1", "person_research": "", "company_research": ""}

    with (
        patch("agent.proxycurl.research_person", new=AsyncMock(return_value="")),
        patch("agent.proxycurl.research_company", new=AsyncMock(return_value="")),
    ):
        result = await research_contact_node(state, config)

    assert result["person_research"] == ""
    assert result["company_research"] == ""


# ── extract_hiring_team_from_jd + extract_hiring_team_node ────────────────────

def test_parse_hiring_team_multiline_format():
    """Parses multi-line 'Meet the hiring team' section."""
    from agent.proxycurl import _parse_hiring_team
    content = "Some intro\nMeet the hiring team\nElizabeth Garcia Nichols\nJob poster · 3rd+"
    result = _parse_hiring_team(content)
    assert result is not None
    assert result["name"] == "Elizabeth Garcia Nichols"


def test_parse_hiring_team_inline_format():
    """Parses inline 'Name · Job poster' format."""
    from agent.proxycurl import _parse_hiring_team
    content = "Elizabeth Garcia Nichols · Job poster\nhttps://www.linkedin.com/in/elizabethgn"
    result = _parse_hiring_team(content)
    assert result is not None
    assert result["name"] == "Elizabeth Garcia Nichols"
    assert "linkedin.com/in/" in result["linkedin_url"]


def test_parse_hiring_team_no_anchor_returns_none():
    """Returns None when no hiring-team keywords are present."""
    from agent.proxycurl import _parse_hiring_team
    content = "This is a job at Acme Corp. Great benefits. Apply now."
    assert _parse_hiring_team(content) is None


@pytest.mark.asyncio
async def test_extract_hiring_team_from_jd_returns_person():
    """Returns parsed person dict when Exa content contains hiring team."""
    from agent.proxycurl import extract_hiring_team_from_jd

    mock_result = MagicMock()
    mock_result.results[0].text = (
        "Meet the hiring team\nElizabeth Garcia Nichols\nJob poster · 3rd+"
    )
    with patch("agent.proxycurl._exa_client") as mock_exa_cls:
        mock_exa_cls.return_value.get_contents.return_value = mock_result
        person = await extract_hiring_team_from_jd(
            "https://www.linkedin.com/jobs/view/123/", "key"
        )

    assert person is not None
    assert person["name"] == "Elizabeth Garcia Nichols"


@pytest.mark.asyncio
async def test_extract_hiring_team_from_jd_returns_none_on_error():
    """Returns None when Exa raises — never propagates the exception."""
    from agent.proxycurl import extract_hiring_team_from_jd

    with patch("agent.proxycurl._exa_client") as mock_exa_cls:
        mock_exa_cls.return_value.get_contents.side_effect = Exception("network error")
        person = await extract_hiring_team_from_jd(
            "https://www.linkedin.com/jobs/view/123/", "key"
        )

    assert person is None


@pytest.mark.asyncio
async def test_extract_hiring_team_node_sets_contact_and_seniority():
    """Sets contact in state and writes JOB_POSTER seniority to DB when person found."""
    from agent.nodes.linkedin_connector import extract_hiring_team_node

    person = {"name": "Elizabeth Garcia Nichols", "title": "Job Poster", "linkedin_url": ""}
    with (
        patch("agent.proxycurl.extract_hiring_team_from_jd", new=AsyncMock(return_value=person)),
        patch("agent.nodes.linkedin_connector.update_outreach_target", new=AsyncMock()) as mock_update,
    ):
        result = await extract_hiring_team_node(
            _base_state(job_url="https://www.linkedin.com/jobs/view/123/"),
            _config(),
        )

    assert result.get("contact") == {
        "name": "Elizabeth Garcia Nichols",
        "title": "Job Poster",
        "profile_url": "",
    }
    assert result["status"] == "enriching"
    mock_update.assert_called_once()
    call_kwargs = mock_update.call_args.kwargs
    assert call_kwargs.get("seniority") == "JOB_POSTER"


@pytest.mark.asyncio
async def test_extract_hiring_team_node_returns_empty_when_not_found():
    """Returns {} so pipeline falls through to discover_contact_node."""
    from agent.nodes.linkedin_connector import extract_hiring_team_node

    with patch("agent.proxycurl.extract_hiring_team_from_jd", new=AsyncMock(return_value=None)):
        result = await extract_hiring_team_node(
            _base_state(job_url="https://www.linkedin.com/jobs/view/123/"),
            _config(),
        )

    assert result == {}


@pytest.mark.asyncio
async def test_extract_hiring_team_node_skips_when_no_url():
    """Returns {} immediately without calling Exa when job_url is empty."""
    from agent.nodes.linkedin_connector import extract_hiring_team_node

    with patch("agent.proxycurl.extract_hiring_team_from_jd", new=AsyncMock()) as mock_fn:
        result = await extract_hiring_team_node(_base_state(job_url=""), _config())

    assert result == {}
    mock_fn.assert_not_called()
