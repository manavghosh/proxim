"""Unit tests for outreach mailer LangGraph nodes (F6) — T025."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


BASE_STATE = {
    "job_id": "job-001",
    "candidate_id": "cand-001",
    "company": "Acme Corp",
    "job_title": "Head of AI",
    "archetype": "Agentic Systems Architect",
    "archetype_confidence": 0.9,
    "hiring_manager_name": "Sarah Chen",
    "cadence_id": "cad-001",
    "discovered_email": None,
    "email_confidence": None,
    "email_source": None,
    "subject": None,
    "day1_body": None,
    "day3_body": None,
    "day7_body": None,
    "generation_attempts": 0,
    "status": "discovering",
    "error": None,
}

CONFIG = {"configurable": {"pool": MagicMock(), "settings": MagicMock(hunter_api_key="key", tracking_host="http://localhost:3000")}}


# ── Email Discovery Tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_discover_email_node_uses_finder_when_name_available_and_score_above_threshold():
    """Hunter Finder finds a deliverable domain-matched email → accepted immediately."""
    state = {**BASE_STATE}

    with patch("agent.nodes.outreach_mailer._find_company_domain",
               new=AsyncMock(return_value="acme.com")), \
         patch("agent.nodes.outreach_mailer.hunter_io.find_email",
               new=AsyncMock(return_value={"email": "sarah@acme.com", "score": 85})), \
         patch("agent.nodes.outreach_mailer.hunter_io.verify_email",
               new=AsyncMock(return_value="deliverable")), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=AsyncMock()):

        from agent.nodes.outreach_mailer import discover_email_node
        result = await discover_email_node(state, CONFIG)

    assert result["discovered_email"] == "sarah@acme.com"
    assert result["email_confidence"] == 95   # max(85, 95) — deliverable + domain match
    assert result["email_source"] == "finder"
    assert result["status"] == "generating"


@pytest.mark.asyncio
async def test_discover_email_node_falls_back_to_domain_search_when_earlier_passes_yield_nothing():
    """Finder/EXA/pattern passes all fail → domain search produces the winning email."""
    state = {**BASE_STATE}

    with patch("agent.nodes.outreach_mailer._find_company_domain",
               new=AsyncMock(return_value="acme.com")), \
         patch("agent.nodes.outreach_mailer.hunter_io.find_email",
               new=AsyncMock(return_value=None)), \
         patch("agent.proxycurl.search_person_email",
               new=AsyncMock(return_value=None)), \
         patch("agent.nodes.outreach_mailer.hunter_io.infer_domain_pattern",
               new=AsyncMock(return_value=None)), \
         patch("agent.nodes.outreach_mailer.hunter_io.generate_email_candidates",
               return_value=[]), \
         patch("agent.nodes.outreach_mailer.hunter_io.domain_search",
               new=AsyncMock(return_value=[{"value": "sarah.chen@acme.com", "confidence": 82}])), \
         patch("agent.nodes.outreach_mailer.hunter_io.verify_email",
               new=AsyncMock(return_value="deliverable")), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=AsyncMock()):

        from agent.nodes.outreach_mailer import discover_email_node
        result = await discover_email_node(state, CONFIG)

    assert result["discovered_email"] == "sarah.chen@acme.com"
    assert result["email_source"] == "domain_search"
    assert result["email_confidence"] == 95   # max(82, 95) — deliverable + domain match


@pytest.mark.asyncio
async def test_discover_email_node_sets_low_confidence_when_best_result_is_risky():
    """All passes return only risky results → best candidate surfaced as low_confidence."""
    state = {**BASE_STATE}

    with patch("agent.nodes.outreach_mailer._find_company_domain",
               new=AsyncMock(return_value="acme.com")), \
         patch("agent.nodes.outreach_mailer.hunter_io.find_email",
               new=AsyncMock(return_value=None)), \
         patch("agent.proxycurl.search_person_email",
               new=AsyncMock(return_value=None)), \
         patch("agent.nodes.outreach_mailer.hunter_io.infer_domain_pattern",
               new=AsyncMock(return_value=None)), \
         patch("agent.nodes.outreach_mailer.hunter_io.generate_email_candidates",
               return_value=[]), \
         patch("agent.nodes.outreach_mailer.hunter_io.domain_search",
               new=AsyncMock(return_value=[{"value": "s@acme.com", "confidence": 45}])), \
         patch("agent.nodes.outreach_mailer.hunter_io.verify_email",
               new=AsyncMock(return_value="risky")), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=AsyncMock()):

        from agent.nodes.outreach_mailer import discover_email_node
        result = await discover_email_node(state, CONFIG)

    # risky + domain-match → min(45, 65)=45 < threshold(75) → stored as risky fallback
    assert result["status"] == "low_confidence"


@pytest.mark.asyncio
async def test_discover_email_node_domain_matched_accept_all_beats_non_domain_deliverable():
    """Key regression: accept_all on company domain wins over deliverable on unrelated domain.

    Reproduces the Crisis24 scenario where anna.veazey@crisis24.com (Hunter, accept_all)
    was wrongly beaten by sales@leadiq.com (EXA, deliverable).
    """
    state = {**BASE_STATE, "company": "Crisis24", "hiring_manager_name": "Anna Veazey"}

    with patch("agent.nodes.outreach_mailer._find_company_domain",
               new=AsyncMock(return_value="crisis24.com")), \
         patch("agent.nodes.outreach_mailer.hunter_io.find_email",
               new=AsyncMock(return_value={"email": "anna@crisis24.com", "score": 85})), \
         patch("agent.nodes.outreach_mailer.hunter_io.verify_email",
               new=AsyncMock(return_value="accept_all")), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=AsyncMock()):

        from agent.nodes.outreach_mailer import discover_email_node
        result = await discover_email_node(state, CONFIG)

    # accept_all + domain match: min(85, 88)=85 ≥ threshold(75) → accepted from Pass 1
    # EXA's deliverable non-domain email is never reached
    assert result["discovered_email"] == "anna@crisis24.com"
    assert result["email_confidence"] == 85   # min(85, 88)
    assert result["email_source"] == "finder"
    assert result["status"] == "generating"


@pytest.mark.asyncio
async def test_discover_email_node_sets_email_not_found_when_no_address_returned():
    """All four passes return nothing → email_not_found status."""
    state = {**BASE_STATE}

    with patch("agent.nodes.outreach_mailer._find_company_domain",
               new=AsyncMock(return_value="acme.com")), \
         patch("agent.nodes.outreach_mailer.hunter_io.find_email",
               new=AsyncMock(return_value=None)), \
         patch("agent.proxycurl.search_person_email",
               new=AsyncMock(return_value=None)), \
         patch("agent.nodes.outreach_mailer.hunter_io.infer_domain_pattern",
               new=AsyncMock(return_value=None)), \
         patch("agent.nodes.outreach_mailer.hunter_io.generate_email_candidates",
               return_value=[]), \
         patch("agent.nodes.outreach_mailer.hunter_io.domain_search",
               new=AsyncMock(return_value=[])), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=AsyncMock()):

        from agent.nodes.outreach_mailer import discover_email_node
        result = await discover_email_node(state, CONFIG)

    assert result["status"] == "email_not_found"


# ── Email Generation Tests ─────────────────────────────────────────────────────

def _make_draft_output(d1="Great email day 1 content here for test purposes that is under word limit",
                       d3="Day three value add under one hundred words",
                       d7="Day seven gentle close under eighty words"):
    mock = MagicMock()
    mock.subject = "Re: Head of AI @ Acme Corp"
    mock.day1_body = d1
    mock.day3_body = d3
    mock.day7_body = d7
    return mock


@pytest.mark.asyncio
async def test_generate_emails_node_produces_three_drafts_within_word_limits():
    state = {**BASE_STATE, "discovered_email": "sarah@acme.com", "email_confidence": 85, "email_source": "finder"}

    with patch("agent.nodes.outreach_mailer.litellm_generate",
               new=AsyncMock(return_value=_make_draft_output())), \
         patch("agent.nodes.outreach_mailer.litellm_self_review",
               new=AsyncMock(return_value=MagicMock(passes=True, feedback=""))), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=AsyncMock()):

        from agent.nodes.outreach_mailer import generate_emails_node
        result = await generate_emails_node(state, CONFIG)

    assert result["subject"] is not None
    assert result["day1_body"] is not None
    assert result["day3_body"] is not None
    assert result["day7_body"] is not None


@pytest.mark.asyncio
async def test_generate_emails_node_rejects_day3_draft_with_forbidden_phrase_following_up():
    from agent.nodes.outreach_mailer import _validate_day3_body
    with pytest.raises(ValueError, match="following up"):
        _validate_day3_body("Just following up on my previous message to check in.")


@pytest.mark.asyncio
async def test_generate_emails_node_rejects_day3_draft_with_forbidden_phrase_checking_in():
    from agent.nodes.outreach_mailer import _validate_day3_body
    with pytest.raises(ValueError, match="checking in"):
        _validate_day3_body("Just checking in to see if you had a chance to review.")


@pytest.mark.asyncio
async def test_generate_emails_node_rejects_day7_draft_with_pressure_language():
    from agent.nodes.outreach_mailer import _validate_day7_body
    with pytest.raises(ValueError, match="last chance"):
        _validate_day7_body("This is your last chance to connect before I move on.")


@pytest.mark.asyncio
async def test_generate_emails_node_retries_on_self_review_failure():
    state = {**BASE_STATE, "discovered_email": "sarah@acme.com", "email_confidence": 85, "email_source": "finder"}

    fail_review = MagicMock(passes=False, feedback="Too generic")
    pass_review = MagicMock(passes=True, feedback="")

    with patch("agent.nodes.outreach_mailer.litellm_generate",
               new=AsyncMock(return_value=_make_draft_output())), \
         patch("agent.nodes.outreach_mailer.litellm_self_review",
               new=AsyncMock(side_effect=[fail_review, pass_review])), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=AsyncMock()):

        from agent.nodes.outreach_mailer import generate_emails_node
        result = await generate_emails_node(state, CONFIG)

    assert result["generation_attempts"] == 2


# ── Write Cadence Checkpoint Tests ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_write_cadence_checkpoint_node_inserts_three_draft_rows_and_sets_pending_approval():
    state = {
        **BASE_STATE,
        "discovered_email": "sarah@acme.com",
        "subject": "Re: Head of AI @ Acme",
        "day1_body": "<p>Day 1</p>",
        "day3_body": "<p>Day 3</p>",
        "day7_body": "<p>Day 7</p>",
    }

    mock_insert_drafts = AsyncMock()
    mock_update_cadence = AsyncMock()

    with patch("agent.nodes.outreach_mailer.insert_email_drafts", new=mock_insert_drafts), \
         patch("agent.nodes.outreach_mailer.update_email_cadence", new=mock_update_cadence):

        from agent.nodes.outreach_mailer import write_cadence_checkpoint_node
        result = await write_cadence_checkpoint_node(state, CONFIG)

    mock_insert_drafts.assert_called_once()
    args = mock_insert_drafts.call_args[0]
    drafts_arg = args[3]
    assert len(drafts_arg) == 3
    day_numbers = [d["day_number"] for d in drafts_arg]
    assert sorted(day_numbers) == [1, 3, 7]

    mock_update_cadence.assert_called()
    # Last call should set pending_approval
    last_kwargs = mock_update_cadence.call_args[1]
    assert last_kwargs.get("status") == "pending_approval"
