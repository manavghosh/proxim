"""Unit tests for the deterministic scoring logic — grade computation, gate logic, truncation."""
import pytest
from agent.scoring_engine import compute_weighted_score, score_to_grade, truncate_jd

WEIGHTS = {
    "compensation": 3, "company_stage": 3, "interview_probability": 3,
    "thought_leadership": 2, "geography": 2, "growth_trajectory": 2,
    "domain_resonance": 2, "hiring_urgency": 1,
}


def test_grade_a_score():
    assert score_to_grade(4.7, gate_failed=False) == "A"


def test_grade_b_score():
    assert score_to_grade(4.2, gate_failed=False) == "B"


def test_grade_c_score():
    assert score_to_grade(3.5, gate_failed=False) == "C"


def test_grade_d_score():
    assert score_to_grade(2.5, gate_failed=False) == "D"


def test_grade_f_low_score():
    assert score_to_grade(1.5, gate_failed=False) == "F"


def test_grade_f_gate_fail_overrides_high_score():
    assert score_to_grade(4.9, gate_failed=True) == "F"


def test_grade_boundary_a_exactly_45():
    assert score_to_grade(4.5, gate_failed=False) == "A"


def test_grade_boundary_b_exactly_40():
    assert score_to_grade(4.0, gate_failed=False) == "B"


def test_compute_weighted_score_all_fives():
    scores = {k: 5.0 for k in WEIGHTS}
    assert compute_weighted_score(scores) == 5.0


def test_compute_weighted_score_all_ones():
    scores = {k: 1.0 for k in WEIGHTS}
    assert compute_weighted_score(scores) == 1.0


def test_compute_weighted_score_mixed():
    # High-weight dims = 5.0, low-weight = 1.0
    # (5*3 + 5*3 + 5*3) + (1*2 + 1*2 + 1*2 + 1*2) + (1*1) = 45 + 8 + 1 = 54 / 18 = 3.0
    scores = {
        "compensation": 5.0, "company_stage": 5.0, "interview_probability": 5.0,
        "thought_leadership": 1.0, "geography": 1.0, "growth_trajectory": 1.0,
        "domain_resonance": 1.0, "hiring_urgency": 1.0,
    }
    assert compute_weighted_score(scores) == 3.0


def test_truncate_jd_under_limit():
    jd = "word " * 100
    result = truncate_jd(jd, max_words=200)
    assert result.strip() == jd.strip()


def test_truncate_jd_over_limit():
    jd = "word " * 5000
    result = truncate_jd(jd, max_words=4000)
    assert len(result.split()) <= 4005
    assert "truncated" in result
