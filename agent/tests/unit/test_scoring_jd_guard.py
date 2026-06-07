"""Tests for the G1 unreadable-JD guard — wall/login pages that slip through as
'jobs' with near-empty descriptions must be detected before scoring."""
from agent.graphs.scoring import _jd_word_count, MIN_SCORABLE_JD_WORDS


def test_empty_jd_is_zero_words():
    assert _jd_word_count("") == 0
    assert _jd_word_count(None) == 0


def test_whitespace_only_is_zero_words():
    assert _jd_word_count("   \n  \t ") == 0


def test_real_jd_counts_words():
    assert _jd_word_count("Director of AI leading enterprise architecture") == 6


def test_wall_page_falls_below_threshold():
    # A LinkedIn search/wall page body is a handful of nav words at most.
    wall = "1,000+ Principal Scientist Jobs in United States"
    assert _jd_word_count(wall) < MIN_SCORABLE_JD_WORDS


def test_substantial_jd_clears_threshold():
    jd = " ".join(["responsibility"] * (MIN_SCORABLE_JD_WORDS + 5))
    assert _jd_word_count(jd) >= MIN_SCORABLE_JD_WORDS
