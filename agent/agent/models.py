"""Pydantic models for the Proxim discovery agent."""
from __future__ import annotations
import operator
from datetime import datetime
from typing import Annotated, Literal, Optional
from pydantic import BaseModel


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


class ScoringState(BaseModel):
    candidate_id:    str
    pipeline_job_id: str
    pipeline_run_id: str = ""
    parsed_profile:  dict = {}
    preferences:     dict = {}
    jobs_to_score:   list[dict] = []
    scored_count:    int = 0
    failed_count:    int = 0
    skipped_count:   int = 0
