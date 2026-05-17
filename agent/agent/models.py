"""Pydantic models for the Proxim discovery agent."""
from __future__ import annotations
import operator
from datetime import datetime
from typing import Annotated, Literal, Optional
from pydantic import BaseModel, field_validator


class RawJob(BaseModel):
    title: str
    company: str
    location: Optional[str] = None
    jd_raw: str
    source: Literal["linkedin", "naukri", "iimjobs", "careers_page", "monster"]
    source_url: str
    application_url: Optional[str] = None
    posted_at: Optional[datetime] = None


class NormalisedJob(RawJob):
    jd_text: str = ""
    is_duplicate: bool = False
    duplicate_of_url: Optional[str] = None


class SourceError(BaseModel):
    source: str
    error: str
    retried: bool = False


class RunSummary(BaseModel):
    sources: dict[str, dict] = {}
    total_new: int = 0
    total_deduped: int = 0
    total_failed_sources: int = 0


class DiscoveryState(BaseModel):
    candidate_id: str
    pipeline_job_id: str
    pipeline_run_id: str = ""
    preferences: dict = {}
    queries: dict[str, list[str]] = {}
    raw_jobs: Annotated[list[RawJob], operator.add] = []
    deduplicated_jobs: list[NormalisedJob] = []
    run_summary: Optional[RunSummary] = None
    errors: Annotated[list[SourceError], operator.add] = []


class FetchJdsState(BaseModel):
    candidate_id: str
    pipeline_job_id: str
    pipeline_run_id: str = ""
    jobs_to_fetch: list[dict] = []
    fetched_count: int = 0
    failed_count: int = 0


# ── 10D Scoring Engine (F9) ───────────────────────────────────────────────────

class DimensionScore(BaseModel):
    score: float
    reasoning: str


class GateScores(BaseModel):
    role_level_match:   DimensionScore
    ai_stack_alignment: DimensionScore


class WeightedScores(BaseModel):
    compensation:          DimensionScore
    company_stage:         DimensionScore
    interview_probability: DimensionScore
    thought_leadership:    DimensionScore
    geography:             DimensionScore
    growth_trajectory:     DimensionScore
    domain_resonance:      DimensionScore
    hiring_urgency:        DimensionScore


class JobScoreOutput(BaseModel):
    gate:                 GateScores
    weighted:             WeightedScores
    numeric_score:        float   # recomputed deterministically in Python
    grade:                str     # recomputed deterministically in Python
    archetype:            str
    archetype_confidence: float


class ScoreReport(BaseModel):
    block_a: str   # Executive Summary — all grades
    block_b: str   # CV Match table — B+ only (empty string otherwise)
    block_c: str   # Gaps & Mitigation — B+ only
    block_d: str   # Level & Positioning — B+ only
    block_e: str   # Compensation Analysis — B+ only
    block_f: str   # Interview Probability — B+ only

    @field_validator('block_a', 'block_b', 'block_c', 'block_d', 'block_e', 'block_f', mode='before')
    @classmethod
    def coerce_list_to_string(cls, v: object) -> str:
        if isinstance(v, list):
            return '\n'.join(str(item) for item in v)
        return v  # type: ignore[return-value]


class ScoringState(BaseModel):
    candidate_id:    str
    pipeline_job_id: str
    pipeline_run_id: str = ""
    parsed_profile:  dict = {}
    preferences:     dict = {}
    job_ids:         list[str] = []  # optional batch filter — empty = score all ready jobs
    jobs_to_score:   list[dict] = []
    scored_count:    int = 0
    failed_count:    int = 0
    skipped_count:   int = 0


# ── Resume Builder (F10) ──────────────────────────────────────────────────────

class RoleSection(BaseModel):
    title:    str
    company:  str
    # Single string, e.g. "2020 — Present". Matches the CV parser's
    # ParsedProfile.roles[].dates output and avoids forcing the LLM to
    # synthesise start/end values that aren't in the source profile.
    dates:    str
    bullets:  list[str] = []


class KeywordSet(BaseModel):
    keywords: list[str]

    @field_validator('keywords', mode='before')
    @classmethod
    def unique_and_trimmed(cls, v: list[str]) -> list[str]:
        seen: dict[str, None] = {}
        for kw in v:
            key = kw.strip().lower()
            if key:
                seen[key] = None
        unique = list(seen.keys())
        if len(unique) < 15:
            raise ValueError(f'Too few unique keywords after dedup: {len(unique)} (need ≥15)')
        return unique[:20]


class PersonalisedResume(BaseModel):
    summary:      str
    roles:        list[RoleSection] = []
    skills:       list[str] = []
    proof_points: list[str] = []
    coherence_ok: bool = False


class CoverLetterContent(BaseModel):
    opening:               str
    body:                  str
    closing:               str
    company_research_used: bool = False


class ResumeBuilderState(BaseModel):
    # Inputs
    candidate_id:         str
    pipeline_job_id:      str
    pipeline_run_id:      str = ""
    job_id:               str = ""
    job_title:            str = ""
    job_company:          str = ""
    jd_raw:               str = ""
    parsed_profile:       dict = {}
    archetype:            str = ""
    archetype_confidence: float = 1.0

    # Intermediate outputs
    keywords:           list[str] = []
    personalised_resume: str = ""   # JSON-serialised PersonalisedResume
    review_feedback:    str = ""
    cover_letter:       str = ""    # JSON-serialised CoverLetterContent

    # Retry tracking
    self_review_attempt: int  = 0
    review_passed:       bool = False

    # Final outputs
    resume_pdf_path:       str = ""
    cover_letter_pdf_path: str = ""
    base_cv_hash:          str = ""
    version_id:            str = ""

    # Error tracking
    error: str = ""
