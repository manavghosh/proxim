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
