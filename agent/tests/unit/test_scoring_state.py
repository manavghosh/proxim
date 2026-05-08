"""Tests for ScoringState — confirms job_ids payload filtering field is present."""
from agent.models import ScoringState


def test_scoring_state_defaults_job_ids_to_empty_list():
    state = ScoringState(candidate_id="c1", pipeline_job_id="p1")
    assert state.job_ids == []


def test_scoring_state_accepts_job_ids_filter():
    state = ScoringState(
        candidate_id="c1",
        pipeline_job_id="p1",
        job_ids=["job-a", "job-b"],
    )
    assert state.job_ids == ["job-a", "job-b"]
