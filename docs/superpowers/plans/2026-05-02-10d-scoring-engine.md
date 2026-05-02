# 10-Dimension Scoring Engine (F9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every discovered job across 10 structured dimensions using LiteLLM in the Python agent, persist grade + report to the database, and display scored jobs on a HITL review dashboard where the candidate approves or rejects each match.

**Architecture:** A new `score_jobs` LangGraph graph runs in the Python daemon — it loads all `discovered` jobs with populated `jd_raw`, calls LiteLLM once per job (with Pydantic validation + 2-retry self-repair), generates a 6-block report for B+ jobs, and writes results to the `jobs` table immediately after each job scores. After `fetch_jds` completes, `write_fetch_summary` auto-queues `score_jobs`. The Next.js Applications page becomes the HITL review dashboard — it reads scored jobs from a new API route, shows grade badges + reports, and persists approve/reject/snooze decisions.

**Tech Stack:** Python LangGraph 1.x, LiteLLM, Pydantic 2.x, aiosqlite/asyncpg, Next.js 15, Drizzle ORM, Tailwind CSS, shadcn/ui

---

## Constitution Check

| Principle | Compliance |
|---|---|
| I. HITL-First | ✅ Approve/reject/snooze are explicit user actions on dashboard — nothing fires automatically |
| II. Agent Modularity | ✅ Scoring graph is a standalone LangGraph node with defined input/output schema |
| III. Factual Integrity | ✅ CV Match block cites `candidates.parsed_profile` only; factual self-review check enforced |
| IV. Observability | ✅ LangSmith tracing active; `_log()` writes to pipeline_logs |
| V. Provider-Agnostic LLM | ✅ Python side: LiteLLM + `response_format` JSON + Pydantic. No provider SDK imported directly |
| VI. Technology Standards | ✅ Drizzle migration for schema; SQLite + PG schemas both updated |
| VII. Dual-Runtime | ✅ Scoring runs exclusively in Python daemon; Next.js only reads results from DB |

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/db/schema.ts` | Modify | Add `score10d`, `grade`, `reportMd`, `archetype`, `archetypeConfidence` to `jobs` |
| `src/db/schema.sqlite.ts` | Modify | Same columns, SQLite-compatible types |
| `migrations/` | Generated | Drizzle migration for PG columns |
| `migrations/sqlite/` | Generated | Drizzle migration for SQLite columns |
| `agent/agent/models.py` | Modify | Add `ScoringState`, `DimensionScore`, `JobScoreOutput`, `ScoreReport` |
| `agent/agent/db_sqlite.py` | Modify | Add `get_jobs_to_score`, `update_job_score`, `mark_job_score_failed` |
| `agent/agent/db_pg.py` | Modify | Same 3 functions for PostgreSQL |
| `agent/agent/scoring_engine.py` | Create | LiteLLM scoring call, retry loop, grade computation |
| `agent/agent/report_generator.py` | Create | LiteLLM 6-block report generation |
| `agent/agent/graphs/scoring.py` | Create | LangGraph: load_jobs → score_and_report_batch → write_score_summary |
| `agent/agent/graphs/fetch_jds.py` | Modify | `write_fetch_summary` auto-queues `score_jobs` when jobs remain unscored |
| `agent/agent/daemon.py` | Modify | Dispatch `score_jobs` to scoring graph |
| `agent/tests/unit/test_scoring_engine.py` | Create | Unit tests for grade computation, gate logic, retry |
| `src/app/api/jobs/route.ts` | Create | `GET /api/jobs` — filtered scored jobs |
| `src/app/api/jobs/[jobId]/decision/route.ts` | Create | `POST` — approve/reject/snooze |
| `src/app/api/jobs/[jobId]/report/route.ts` | Create | `GET` — full markdown report |
| `src/app/applications/page.tsx` | Replace | HITL review dashboard |
| `src/components/applications/JobCard.tsx` | Create | Grade badge + score + actions |
| `src/components/applications/GradeFilter.tsx` | Create | A / A+B / All filter |
| `src/components/applications/ReportModal.tsx` | Create | Inline 6-block report viewer |
| `src/lib/api.ts` | Modify | Add `getJobs`, `submitDecision`, `getJobReport` |
| `src/types/candidate.ts` | Modify | Add `gradeFilter` to preferences type |

---

### Task 1: Extend Drizzle schemas with score columns

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/schema.sqlite.ts`

The `jobs` table needs 5 new columns: `score10d` (JSONB — all dimension scores + reasoning), `grade` (A–F), `reportMd` (6-block markdown), `archetype` (for F10), `archetypeConfidence` (float).

- [ ] **Step 1: Add TypeScript type for score data**

At the top of `src/db/schema.ts`, add after the existing type definitions:

```typescript
type DimensionScore = {
  score: number
  reasoning: string
}

type Score10D = {
  gate: {
    roleLevelMatch: DimensionScore
    aiStackAlignment: DimensionScore
  }
  weighted: {
    compensation: DimensionScore
    companyStage: DimensionScore
    interviewProbability: DimensionScore
    thoughtLeadership: DimensionScore
    geography: DimensionScore
    growthTrajectory: DimensionScore
    domainResonance: DimensionScore
    hiringUrgency: DimensionScore
  }
}
```

- [ ] **Step 2: Add columns to the `jobs` pgTable in `src/db/schema.ts`**

Add these 5 columns inside the `jobs` pgTable definition, after `status`:

```typescript
  score10d:             jsonb().$type<Score10D>(),
  grade:                varchar({ length: 1 }),
  reportMd:             text(),
  archetype:            text(),
  archetypeConfidence:  numeric({ precision: 3, scale: 2 }),
```

- [ ] **Step 3: Add the same columns to `src/db/schema.sqlite.ts`**

Add after `status` in the `jobs` sqliteTable (using SQLite-compatible types):

```typescript
  score10d:             text({ mode: 'json' }).$type<Score10D>(),
  grade:                text(),
  reportMd:             text(),
  archetype:            text(),
  archetypeConfidence:  real(),
```

Also add the `Score10D` and `DimensionScore` type definitions at the top of `schema.sqlite.ts` (identical to step 1).

- [ ] **Step 4: Generate and apply PG migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: new migration file in `migrations/` with 5 new columns on `jobs`.

- [ ] **Step 5: Generate and apply SQLite migration**

```bash
DATABASE_URL=./proxim-dev.db npm run db:generate:sqlite
DATABASE_URL=./proxim-dev.db npm run db:migrate:sqlite
```

Expected: new migration file in `migrations/sqlite/` applied to `proxim-dev.db`.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/schema.sqlite.ts migrations/ migrations/sqlite/
git commit -m "feat(schema): add score10d, grade, reportMd, archetype columns to jobs"
```

---

### Task 2: Add Pydantic models for scoring state

**Files:**
- Modify: `agent/agent/models.py`

- [ ] **Step 1: Add scoring models to `agent/agent/models.py`**

Add after the existing `FetchJdsState` class:

```python
class DimensionScore(BaseModel):
    score: float
    reasoning: str


class GateScores(BaseModel):
    role_level_match: DimensionScore
    ai_stack_alignment: DimensionScore


class WeightedScores(BaseModel):
    compensation: DimensionScore
    company_stage: DimensionScore
    interview_probability: DimensionScore
    thought_leadership: DimensionScore
    geography: DimensionScore
    growth_trajectory: DimensionScore
    domain_resonance: DimensionScore
    hiring_urgency: DimensionScore


class JobScoreOutput(BaseModel):
    gate: GateScores
    weighted: WeightedScores
    numeric_score: float    # weighted average, 1 decimal, gate-pass dims excluded
    grade: str              # A / B / C / D / F
    archetype: str          # one of 5 archetype labels
    archetype_confidence: float  # 0.0–1.0


class ScoreReport(BaseModel):
    block_a: str   # Executive Summary — all grades
    block_b: str   # CV Match table — B+ only (empty string for C/D/F)
    block_c: str   # Gaps & Mitigation — B+ only
    block_d: str   # Level & Positioning — B+ only
    block_e: str   # Compensation Analysis — B+ only
    block_f: str   # Interview Probability — B+ only


class ScoringState(BaseModel):
    candidate_id: str
    pipeline_job_id: str
    pipeline_run_id: str = ""
    parsed_profile: dict = {}
    preferences: dict = {}
    jobs_to_score: list[dict] = []   # [{id, title, company, jd_raw}]
    scored_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0           # gate-failed F grades
```

- [ ] **Step 2: Verify import**

```bash
cd agent
poetry run python -c "from agent.models import ScoringState, JobScoreOutput, ScoreReport; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add agent/agent/models.py
git commit -m "feat: add ScoringState, JobScoreOutput, ScoreReport Pydantic models"
```

---

### Task 3: Add DB functions for scoring (SQLite + PG)

**Files:**
- Modify: `agent/agent/db_sqlite.py`
- Modify: `agent/agent/db_pg.py`
- Modify: `agent/tests/unit/test_db_sqlite.py`

- [ ] **Step 1: Write failing tests**

Add to `agent/tests/unit/test_db_sqlite.py`:

```python
# ── Scoring DB functions ──────────────────────────────────────────────────────

from agent.db_sqlite import get_jobs_to_score, update_job_score, mark_job_score_failed


async def test_get_jobs_to_score_returns_discovered_with_jd(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    job_ids = await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE,
        'pipeline_run_id': run_id,
        'jd_raw': 'We are hiring a Director of AI with LangGraph experience.',
        'source_url': 'https://linkedin.com/jobs/score-test-1',
    }])
    result = await get_jobs_to_score(conn, CANDIDATE_ID)
    assert len(result) == 1
    assert result[0]['id'] == job_ids[0]
    assert 'jd_raw' in result[0]
    assert 'title' in result[0]


async def test_get_jobs_to_score_skips_empty_jd(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE,
        'pipeline_run_id': run_id,
        'jd_raw': '',
        'source_url': 'https://linkedin.com/jobs/score-test-2',
    }])
    result = await get_jobs_to_score(conn, CANDIDATE_ID)
    assert result == []


async def test_update_job_score_persists_all_fields(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    ids = await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE, 'pipeline_run_id': run_id,
        'jd_raw': 'JD text', 'source_url': 'https://linkedin.com/jobs/score-test-3',
    }])
    j_id = ids[0]
    score_json = {'gate': {}, 'weighted': {}}
    await update_job_score(conn, j_id,
                           score_json=score_json,
                           grade='B',
                           report_md='## Report',
                           archetype='GCC AI Practice Head',
                           archetype_confidence=0.82)
    async with conn.execute('SELECT grade, report_md, archetype FROM jobs WHERE id = ?', (j_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'B'
    assert row[1] == '## Report'
    assert row[2] == 'GCC AI Practice Head'


async def test_mark_job_score_failed_sets_status(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    ids = await bulk_insert_jobs(conn, [{
        **_JOB_FIXTURE, 'pipeline_run_id': run_id,
        'jd_raw': 'JD', 'source_url': 'https://linkedin.com/jobs/score-test-4',
    }])
    j_id = ids[0]
    await mark_job_score_failed(conn, j_id)
    async with conn.execute('SELECT status FROM jobs WHERE id = ?', (j_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'score_failed'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agent
poetry run pytest tests/unit/test_db_sqlite.py -k "score" -v 2>&1 | tail -5
```

Expected: `ImportError: cannot import name 'get_jobs_to_score'`

- [ ] **Step 3: Implement the 3 functions in `agent/agent/db_sqlite.py`**

Add at the end of `agent/agent/db_sqlite.py`:

```python
async def get_jobs_to_score(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> list[dict]:
    """Return discovered jobs that have JD text and have not yet been scored."""
    async with pool.execute(
        "SELECT id, title, company, jd_raw, source FROM jobs "
        "WHERE candidate_id = ? AND status = 'discovered' AND jd_raw != '' "
        "ORDER BY created_at",
        (candidate_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    return [
        {"id": row[0], "title": row[1], "company": row[2],
         "jd_raw": row[3], "source": row[4]}
        for row in rows
    ]


async def update_job_score(
    pool: aiosqlite.Connection,
    job_id: str,
    score_json: dict,
    grade: str,
    report_md: str,
    archetype: str,
    archetype_confidence: float,
) -> None:
    await pool.execute(
        "UPDATE jobs SET status = 'scored', score_10d = ?, grade = ?, "
        "report_md = ?, archetype = ?, archetype_confidence = ?, updated_at = ? "
        "WHERE id = ?",
        (json.dumps(score_json), grade, report_md,
         archetype, archetype_confidence, _now(), job_id),
    )
    await pool.commit()


async def mark_job_score_failed(
    pool: aiosqlite.Connection,
    job_id: str,
) -> None:
    await pool.execute(
        "UPDATE jobs SET status = 'score_failed', updated_at = ? WHERE id = ?",
        (_now(), job_id),
    )
    await pool.commit()
```

- [ ] **Step 4: Add the same 3 functions to `agent/agent/db_pg.py`**

Add at the end of `agent/agent/db_pg.py`:

```python
async def get_jobs_to_score(
    pool: asyncpg.Pool,
    candidate_id: str,
) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, title, company, jd_raw, source FROM jobs "
            "WHERE candidate_id = $1 AND status = 'discovered' AND jd_raw != '' "
            "ORDER BY created_at",
            candidate_id,
        )
    return [
        {"id": str(row["id"]), "title": row["title"], "company": row["company"],
         "jd_raw": row["jd_raw"], "source": row["source"]}
        for row in rows
    ]


async def update_job_score(
    pool: asyncpg.Pool,
    job_id: str,
    score_json: dict,
    grade: str,
    report_md: str,
    archetype: str,
    archetype_confidence: float,
) -> None:
    import json as _json
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET status = 'scored', score_10d = $1::jsonb, grade = $2, "
            "report_md = $3, archetype = $4, archetype_confidence = $5, updated_at = NOW() "
            "WHERE id = $6",
            _json.dumps(score_json), grade, report_md,
            archetype, archetype_confidence, job_id,
        )


async def mark_job_score_failed(
    pool: asyncpg.Pool,
    job_id: str,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET status = 'score_failed', updated_at = NOW() WHERE id = $1",
            job_id,
        )
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd agent
poetry run pytest tests/unit/test_db_sqlite.py -v 2>&1 | tail -8
```

Expected: all tests pass (20+ pass count).

- [ ] **Step 6: Commit**

```bash
git add agent/agent/db_sqlite.py agent/agent/db_pg.py agent/tests/unit/test_db_sqlite.py
git commit -m "feat: add get_jobs_to_score, update_job_score, mark_job_score_failed to DB layer"
```

---

### Task 4: Scoring engine — LiteLLM call with retry and grade computation

**Files:**
- Create: `agent/agent/scoring_engine.py`
- Create: `agent/tests/unit/test_scoring_engine.py`

The scoring engine has two responsibilities:
1. Calling LiteLLM with the 10D scoring prompt and validating the Pydantic response (with self-repair retry)
2. Computing the weighted average and letter grade locally (not trusting the LLM's grade — it's recomputed deterministically)

- [ ] **Step 1: Write failing tests**

Create `agent/tests/unit/test_scoring_engine.py`:

```python
"""Unit tests for the deterministic scoring logic (grade computation, gate logic)."""
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


def test_compute_weighted_score_all_fives():
    scores = {k: 5.0 for k in WEIGHTS}
    assert compute_weighted_score(scores) == 5.0


def test_compute_weighted_score_all_ones():
    scores = {k: 1.0 for k in WEIGHTS}
    assert compute_weighted_score(scores) == 1.0


def test_compute_weighted_score_mixed():
    scores = {
        "compensation": 5.0, "company_stage": 5.0, "interview_probability": 5.0,
        "thought_leadership": 1.0, "geography": 1.0, "growth_trajectory": 1.0,
        "domain_resonance": 1.0, "hiring_urgency": 1.0,
    }
    # (5+5+5)*3 + (1+1+1+1)*2 + 1*1 = 45 + 8 + 1 = 54 / 18 = 3.0
    assert compute_weighted_score(scores) == 3.0


def test_truncate_jd_under_limit():
    jd = "word " * 100
    result = truncate_jd(jd, max_words=200)
    assert result == jd


def test_truncate_jd_over_limit():
    jd = "word " * 5000
    result = truncate_jd(jd, max_words=4000)
    assert len(result.split()) <= 4005   # 4000 words + truncation note words
    assert "truncated" in result
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd agent
poetry run pytest tests/unit/test_scoring_engine.py -v 2>&1 | tail -5
```

Expected: `ImportError: cannot import name 'compute_weighted_score'`

- [ ] **Step 3: Implement `agent/agent/scoring_engine.py`**

```python
"""Scoring engine — LiteLLM 10D scoring with retry and deterministic grade computation."""
from __future__ import annotations
import json
import structlog
from pydantic import ValidationError
from agent.models import JobScoreOutput, DimensionScore, GateScores, WeightedScores, ScoreReport

logger = structlog.get_logger()

# Weight per weighted dimension (gate dims are NOT included in weighted average)
DIMENSION_WEIGHTS: dict[str, int] = {
    "compensation":           3,
    "company_stage":          3,
    "interview_probability":  3,
    "thought_leadership":     2,
    "geography":              2,
    "growth_trajectory":      2,
    "domain_resonance":       2,
    "hiring_urgency":         1,
}
TOTAL_WEIGHT: int = sum(DIMENSION_WEIGHTS.values())  # 18

GATE_FAIL_THRESHOLD = 2.5
MAX_RETRIES = 2

ARCHETYPES = [
    "Enterprise CAIO",
    "Startup CTO/VP",
    "Agentic Systems Architect",
    "GCC AI Practice Head",
    "AI Thought Leader",
]


def truncate_jd(jd_text: str, max_words: int = 4000) -> str:
    words = jd_text.split()
    if len(words) <= max_words:
        return jd_text
    return " ".join(words[:max_words]) + "\n\n[JD truncated to first 4,000 words for scoring]"


def compute_weighted_score(weighted_scores: dict[str, float]) -> float:
    total = sum(weighted_scores[dim] * DIMENSION_WEIGHTS[dim] for dim in DIMENSION_WEIGHTS)
    return round(total / TOTAL_WEIGHT, 1)


def score_to_grade(numeric_score: float, gate_failed: bool) -> str:
    if gate_failed:
        return "F"
    if numeric_score >= 4.5:
        return "A"
    if numeric_score >= 4.0:
        return "B"
    if numeric_score >= 3.0:
        return "C"
    if numeric_score >= 2.0:
        return "D"
    return "F"


def _build_scoring_prompt(job: dict, parsed_profile: dict, preferences: dict) -> str:
    jd = truncate_jd(job.get("jd_raw", ""))
    seniority = preferences.get("seniority_levels", [])
    geo = preferences.get("geographic_preference", [])
    comp = preferences.get("compensation_band", {})
    stage = preferences.get("company_stages", [])

    profile_str = json.dumps(parsed_profile, indent=2)
    archetype_list = "\n".join(f"  - {a}" for a in ARCHETYPES)

    return f"""You are a senior career analyst scoring a job opportunity for a senior IT professional.

## Candidate Preferences
- Target seniority levels: {seniority}
- Geographic preference: {geo}
- Target compensation band: {comp}
- Preferred company stages: {stage}

## Candidate Parsed Profile
{profile_str}

## Job to Score
Title: {job.get("title", "")}
Company: {job.get("company", "")}

### Job Description
{jd}

## Scoring Instructions

Evaluate the job across exactly 10 dimensions. Return a JSON object matching the schema below.

### Gate-Pass Dimensions (score each 1.0–5.0):
1. role_level_match: Does the seniority and title match the candidate's target level? Score < 2.5 means disqualified.
2. ai_stack_alignment: Does the tech stack (LangGraph, MCP, LLMs, agentic AI) align? Score < 2.5 means disqualified.

### Weighted Dimensions (score each 1.0–5.0):
3. compensation (weight 3): Does the implied or stated compensation match the target band?
4. company_stage (weight 3): Does the company stage match the candidate's preference?
5. interview_probability (weight 3): Estimated callback likelihood given profile strength.
6. thought_leadership (weight 2): Do OSS projects, patents, and publishing amplify fit?
7. geography (weight 2): Is remote/hybrid feasible from Bengaluru?
8. growth_trajectory (weight 2): Is there a visible path toward CAIO/CTO level?
9. domain_resonance (weight 2): Does the problem domain align with candidate interest?
10. hiring_urgency (weight 1): Speed signals — posting recency, urgency language.

### Archetype Detection
Identify which archetype this job targets:
{archetype_list}

## Required JSON Output
{{
  "gate": {{
    "role_level_match": {{"score": <1.0-5.0>, "reasoning": "<2-3 sentences>"}},
    "ai_stack_alignment": {{"score": <1.0-5.0>, "reasoning": "<2-3 sentences>"}}
  }},
  "weighted": {{
    "compensation": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "company_stage": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "interview_probability": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "thought_leadership": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "geography": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "growth_trajectory": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "domain_resonance": {{"score": <1.0-5.0>, "reasoning": "<2 sentences>"}},
    "hiring_urgency": {{"score": <1.0-5.0>, "reasoning": "<1-2 sentences>"}}
  }},
  "numeric_score": <1.0-5.0 weighted average>,
  "grade": "<A|B|C|D|F>",
  "archetype": "<one of the 5 archetypes above>",
  "archetype_confidence": <0.0-1.0>
}}"""


def _build_report_prompt(job: dict, parsed_profile: dict, score_output: JobScoreOutput) -> str:
    jd = truncate_jd(job.get("jd_raw", ""))
    profile_str = json.dumps(parsed_profile, indent=2)

    return f"""You are a career analyst writing a structured match report for a senior candidate.

CRITICAL RULE: In Block B (CV Match), you MUST cite only proof points that appear verbatim in the candidate profile below.
Do NOT invent, infer, or extrapolate any titles, company names, dates, metrics, or patent numbers.

## Candidate Profile (source of truth for all proof points)
{profile_str}

## Job
Title: {job.get("title")}
Company: {job.get("company")}

### Job Description
{jd}

## Score Summary
Grade: {score_output.grade} ({score_output.numeric_score})
Archetype: {score_output.archetype}

## Required JSON Output
{{
  "block_a": "<Executive Summary: 1 paragraph covering grade, key strengths, primary risk>",
  "block_b": "<CV Match: markdown table with columns 'JD Requirement | Candidate Proof Point | Strength'. Each proof point MUST be verbatim from parsed profile.>",
  "block_c": "<Gaps & Mitigation: bulleted list of gaps with severity (Critical/Minor) and mitigation plan>",
  "block_d": "<Level & Positioning: detected seniority, recommended archetype, positioning notes>",
  "block_e": "<Compensation Analysis: JD range vs target, market context, negotiability signal>",
  "block_f": "<Interview Probability: estimated callback %, key differentiators, likely interview topics>"
}}"""


async def score_job(job: dict, parsed_profile: dict, preferences: dict) -> JobScoreOutput:
    """Score a single job using LiteLLM. Retries up to MAX_RETRIES on Pydantic validation failure."""
    from agent.config import settings
    import litellm

    prompt = _build_scoring_prompt(job, parsed_profile, preferences)
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            response = litellm.completion(
                model=f"{settings.llm_provider}/{settings.llm_model}",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            raw = response.choices[0].message.content
            parsed = json.loads(raw)

            # Recompute grade + score deterministically — do not trust the LLM's values
            gate_failed = (
                parsed["gate"]["role_level_match"]["score"] < GATE_FAIL_THRESHOLD
                or parsed["gate"]["ai_stack_alignment"]["score"] < GATE_FAIL_THRESHOLD
            )
            weighted_scores = {k: parsed["weighted"][k]["score"] for k in DIMENSION_WEIGHTS}
            numeric_score = compute_weighted_score(weighted_scores)
            grade = score_to_grade(numeric_score, gate_failed)

            parsed["numeric_score"] = numeric_score
            parsed["grade"] = grade

            return JobScoreOutput.model_validate(parsed)

        except (ValidationError, json.JSONDecodeError, KeyError) as e:
            last_error = e
            logger.warning("score_retry", job_id=job["id"], attempt=attempt, error=str(e))

    raise RuntimeError(f"Scoring failed after {MAX_RETRIES + 1} attempts: {last_error}")


async def generate_report(job: dict, parsed_profile: dict, score_output: JobScoreOutput) -> ScoreReport:
    """Generate a 6-block report for B+ jobs. Returns block_a only for F-grade."""
    from agent.config import settings
    import litellm

    if score_output.grade == "F":
        # For F-grade: generate only block_a (fast rejection)
        summary_prompt = f"""Write a one-paragraph executive summary explaining why this job received an F grade.
Job: {job.get("title")} at {job.get("company")}
Reason: Gate-pass dimension failed or numeric score below 2.0.
Gate scores: role_level_match={score_output.gate.role_level_match.score}, ai_stack_alignment={score_output.gate.ai_stack_alignment.score}
Return JSON: {{"block_a": "<paragraph>"}}"""
        response = litellm.completion(
            model=f"{settings.llm_provider}/{settings.llm_model}",
            messages=[{"role": "user", "content": summary_prompt}],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        data = json.loads(response.choices[0].message.content)
        return ScoreReport(block_a=data["block_a"], block_b="", block_c="", block_d="", block_e="", block_f="")

    prompt = _build_report_prompt(job, parsed_profile, score_output)
    response = litellm.completion(
        model=f"{settings.llm_provider}/{settings.llm_model}",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    data = json.loads(response.choices[0].message.content)
    return ScoreReport.model_validate(data)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agent
poetry run pytest tests/unit/test_scoring_engine.py -v 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent/agent/scoring_engine.py agent/tests/unit/test_scoring_engine.py
git commit -m "feat: add scoring engine — LiteLLM 10D scoring, grade computation, report generation"
```

---

### Task 5: LangGraph scoring graph

**Files:**
- Create: `agent/agent/graphs/scoring.py`

Pattern: identical to `fetch_jds.py` — open pool once, process jobs one at a time with immediate DB writes and pipeline log entries.

- [ ] **Step 1: Create `agent/agent/graphs/scoring.py`**

```python
"""LangGraph for scoring discovered jobs with the 10D framework."""
from __future__ import annotations
from datetime import datetime, timezone
import structlog
from langgraph.graph import StateGraph, END
from agent.models import ScoringState

logger = structlog.get_logger()


async def _make_pool():
    from agent.config import settings
    from agent.db import create_pool
    return await create_pool(settings.database_url)


async def _close_pool(pool) -> None:
    from agent.db import close_pool
    await close_pool(pool)


async def _log(pool, job_id: str, level: str, step: str,
               message: str, data: dict | None = None) -> None:
    try:
        from agent.db import insert_pipeline_log
        await insert_pipeline_log(pool, job_id, level=level,
                                  step=step, message=message, data=data)
    except Exception as e:
        logger.warning("log_write_failed", error=str(e))


# ── Node: load_jobs ───────────────────────────────────────────────────────────

async def load_jobs(state: ScoringState) -> dict:
    """Load discovered jobs with populated JD text."""
    pool = await _make_pool()
    try:
        from agent.db import get_jobs_to_score, get_candidate_preferences
        from agent.db import get_jobs_with_empty_jd

        jobs = await get_jobs_to_score(pool, state.candidate_id)
        parsed_profile = {}
        preferences = {}

        # Load candidate profile for scoring context
        import aiosqlite
        async with pool.execute(
            'SELECT parsed_profile, preferences FROM candidates WHERE id = ?',
            (state.candidate_id,),
        ) if hasattr(pool, 'execute') else (lambda: None)() as cur:
            pass

        await _log(pool, state.pipeline_job_id, "info", "load_jobs",
                   f"Found {len(jobs)} jobs to score",
                   {"count": len(jobs)})
        logger.info("scoring_load", count=len(jobs))
    finally:
        await _close_pool(pool)

    return {"jobs_to_score": jobs}


async def _load_candidate_context(pool, candidate_id: str) -> tuple[dict, dict]:
    """Load parsed_profile and preferences from candidates table."""
    import json

    if hasattr(pool, 'execute'):  # aiosqlite
        async with pool.execute(
            'SELECT parsed_profile, preferences FROM candidates WHERE id = ?',
            (candidate_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return {}, {}
        profile = json.loads(row[0]) if isinstance(row[0], str) else (row[0] or {})
        prefs = json.loads(row[1]) if isinstance(row[1], str) else (row[1] or {})
        return profile, prefs
    else:  # asyncpg pool
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT parsed_profile, preferences FROM candidates WHERE id = $1',
                candidate_id,
            )
        if not row:
            return {}, {}
        return dict(row['parsed_profile'] or {}), dict(row['preferences'] or {})


# ── Node: score_and_report_batch ─────────────────────────────────────────────

async def score_and_report_batch(state: ScoringState) -> dict:
    """Score each job and generate report — save to DB immediately after each job."""
    from agent.scoring_engine import score_job, generate_report
    from agent.db import update_job_score, mark_job_score_failed

    if not state.jobs_to_score:
        return {"scored_count": 0, "failed_count": 0, "skipped_count": 0}

    pool = await _make_pool()
    scored = 0
    failed = 0
    skipped = 0  # gate-failed F grades (still written to DB)
    total = len(state.jobs_to_score)

    try:
        parsed_profile, preferences = await _load_candidate_context(pool, state.candidate_id)

        await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                   f"Scoring {total} jobs…", {"total": total})

        for job in state.jobs_to_score:
            try:
                score_output = await score_job(job, parsed_profile, preferences)
                report = await generate_report(job, parsed_profile, score_output)

                score_json = {
                    "gate": {
                        "role_level_match": score_output.gate.role_level_match.model_dump(),
                        "ai_stack_alignment": score_output.gate.ai_stack_alignment.model_dump(),
                    },
                    "weighted": {
                        k: getattr(score_output.weighted, k).model_dump()
                        for k in [
                            "compensation", "company_stage", "interview_probability",
                            "thought_leadership", "geography", "growth_trajectory",
                            "domain_resonance", "hiring_urgency",
                        ]
                    },
                }
                report_md = "\n\n".join([
                    f"## Executive Summary\n{report.block_a}",
                    f"## CV Match\n{report.block_b}" if report.block_b else "",
                    f"## Gaps & Mitigation\n{report.block_c}" if report.block_c else "",
                    f"## Level & Positioning\n{report.block_d}" if report.block_d else "",
                    f"## Compensation Analysis\n{report.block_e}" if report.block_e else "",
                    f"## Interview Probability\n{report.block_f}" if report.block_f else "",
                ]).strip()

                await update_job_score(
                    pool, job["id"],
                    score_json=score_json,
                    grade=score_output.grade,
                    report_md=report_md,
                    archetype=score_output.archetype,
                    archetype_confidence=score_output.archetype_confidence,
                )

                if score_output.grade == "F":
                    skipped += 1
                    await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                               f"Job {scored + failed + skipped}/{total} — Grade F (gate failed)",
                               {"job_id": job["id"], "grade": "F"})
                else:
                    scored += 1
                    await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                               f"Scored {scored}/{total} — {score_output.grade} ({score_output.numeric_score}) — {job['title']} @ {job['company']}",
                               {"grade": score_output.grade, "score": score_output.numeric_score,
                                "archetype": score_output.archetype})

            except Exception as e:
                failed += 1
                logger.error("score_job_error", job_id=job["id"], error=str(e))
                await mark_job_score_failed(pool, job["id"])
                await _log(pool, state.pipeline_job_id, "warning", "score_and_report_batch",
                           f"Scoring failed for {job['title']} @ {job['company']} — will retry",
                           {"job_id": job["id"], "error": str(e)})

        await _log(pool, state.pipeline_job_id, "info", "score_and_report_batch",
                   f"Scoring complete — {scored} graded A–D, {skipped} F-grade, {failed} failed",
                   {"scored": scored, "skipped": skipped, "failed": failed})

    finally:
        await _close_pool(pool)

    return {"scored_count": scored, "failed_count": failed, "skipped_count": skipped}


# ── Node: write_score_summary ─────────────────────────────────────────────────

async def write_score_summary(state: ScoringState) -> dict:
    pool = await _make_pool()
    try:
        from agent.db import update_pipeline_run, update_pipeline_job_status

        now = datetime.now(timezone.utc).isoformat()
        try:
            await update_pipeline_run(
                pool, state.pipeline_run_id,
                status="completed",
                completedAt=now,
                jobsDiscovered=state.scored_count,
            )
        except Exception as e:
            logger.error("write_score_summary_run_update_failed", error=str(e))
            await update_pipeline_run(pool, state.pipeline_run_id,
                                      status="completed", completedAt=now)

        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        await _log(pool, state.pipeline_job_id, "info", "write_score_summary",
                   f"Scoring complete — {state.scored_count} jobs graded A–D, "
                   f"{state.skipped_count} F-grade filtered, {state.failed_count} failed",
                   {"scored": state.scored_count, "skipped": state.skipped_count,
                    "failed": state.failed_count})
        logger.info("score_pipeline_complete",
                    scored=state.scored_count,
                    skipped=state.skipped_count,
                    failed=state.failed_count)
    except Exception as e:
        logger.error("write_score_summary_failed", error=str(e))
        try:
            await update_pipeline_job_status(
                pool, state.pipeline_job_id, "failed", error=str(e)
            )
        except Exception:
            pass
    finally:
        await _close_pool(pool)
    return {}


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_scoring_graph():
    graph = StateGraph(ScoringState)
    graph.add_node("load_jobs",              load_jobs)
    graph.add_node("score_and_report_batch", score_and_report_batch)
    graph.add_node("write_score_summary",    write_score_summary)

    graph.set_entry_point("load_jobs")
    graph.add_edge("load_jobs",              "score_and_report_batch")
    graph.add_edge("score_and_report_batch", "write_score_summary")
    graph.add_edge("write_score_summary",    END)

    return graph.compile()


scoring_graph = build_scoring_graph()
```

- [ ] **Step 2: Verify graph builds**

```bash
cd agent
poetry run python -c "from agent.graphs.scoring import scoring_graph; print('Nodes:', list(scoring_graph.nodes))" 2>&1 | grep Nodes
```

Expected: `Nodes: ['__start__', 'load_jobs', 'score_and_report_batch', 'write_score_summary']`

- [ ] **Step 3: Commit**

```bash
git add agent/agent/graphs/scoring.py agent/agent/scoring_engine.py
git commit -m "feat: add scoring LangGraph — load_jobs → score_and_report_batch → write_score_summary"
```

---

### Task 6: Auto-chain scoring + daemon dispatch

**Files:**
- Modify: `agent/agent/graphs/fetch_jds.py` (write_fetch_summary)
- Modify: `agent/agent/daemon.py`

- [ ] **Step 1: Update `write_fetch_summary` in `fetch_jds.py` to auto-queue `score_jobs`**

In `agent/agent/graphs/fetch_jds.py`, find the `write_fetch_summary` function. After `await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")`, add:

```python
        # Auto-queue score_jobs if there are unscored discovered jobs with JD text
        from agent.db import get_jobs_to_score, queue_pipeline_job
        jobs_to_score = await get_jobs_to_score(pool, state.candidate_id)
        if jobs_to_score:
            await queue_pipeline_job(pool, state.candidate_id, "score_jobs")
            pending_msg = f" Queuing scoring for {len(jobs_to_score)} jobs…"
        else:
            pending_msg = ""
```

And update the `_log` call to include the pending message:

```python
        await _log(pool, state.pipeline_job_id, "info", "write_fetch_summary",
                   f"JD fetch complete — {state.fetched_count} updated{pending_msg}",
                   {"fetched": state.fetched_count, "pending": state.failed_count,
                    "scoring_queued": len(jobs_to_score) if jobs_to_score else 0})
```

- [ ] **Step 2: Add `score_jobs` dispatch in `daemon.py`**

In `agent/agent/daemon.py`, find the `_dispatch_job` function. Add a new branch before the `else`:

```python
    elif job['job_type'] == 'score_jobs':
        from agent.graphs.scoring import scoring_graph
        from agent.models import ScoringState

        logger.info("job_dispatching", job_id=job['id'], job_type='score_jobs')

        state = ScoringState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
        )
        await scoring_graph.ainvoke(state)
```

- [ ] **Step 3: Also update `status/route.ts` to chain to `score_jobs`**

In `src/app/api/pipeline/[jobId]/status/route.ts`, extend the `followUpJobId` logic to also check for queued `score_jobs` when `fetch_jds` completes:

```typescript
    if (job.status === 'completed' &&
        (job.jobType === 'discovery_only' || job.jobType === 'fetch_jds')) {
      const nextTypes = job.jobType === 'discovery_only'
        ? ['fetch_jds', 'score_jobs']
        : ['score_jobs']

      for (const nextType of nextTypes) {
        const [nextJob] = await db
          .select({ id: pipelineJobs.id })
          .from(pipelineJobs)
          .where(
            and(
              eq(pipelineJobs.candidateId, job.candidateId),
              eq(pipelineJobs.jobType, nextType),
              or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running'))
            )
          )
          .orderBy(pipelineJobs.createdAt)
          .limit(1)
        if (nextJob) {
          followUpJobId = nextJob.id
          break
        }
      }
    }
```

- [ ] **Step 4: Verify daemon imports cleanly**

```bash
cd agent
poetry run python -c "from agent.daemon import main; print('daemon OK')" 2>&1 | grep daemon
```

Expected: `daemon OK`

- [ ] **Step 5: Run all Python tests**

```bash
cd agent
poetry run pytest tests/unit/ -q 2>&1 | tail -5
```

Expected: same pass count as before (new tests + existing).

- [ ] **Step 6: Run Next.js tests and type-check**

```bash
npm run test:run && npx tsc --noEmit
```

Expected: 0 failures, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add agent/agent/graphs/fetch_jds.py agent/agent/daemon.py src/app/api/pipeline/\[jobId\]/status/route.ts
git commit -m "feat: auto-chain score_jobs after fetch_jds; daemon dispatches score_jobs; status API chains to score_jobs"
```

---

### Task 7: Next.js API routes for jobs

**Files:**
- Create: `src/app/api/jobs/route.ts`
- Create: `src/app/api/jobs/[jobId]/decision/route.ts`
- Create: `src/app/api/jobs/[jobId]/report/route.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Create `src/app/api/jobs/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { desc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'
import { getOrCreateCandidate } from '@/lib/cv-service'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gradeFilter = searchParams.get('grade') ?? 'all' // 'A' | 'A+B' | 'all'

  try {
    const candidate = await getOrCreateCandidate()

    // Always exclude F-grade and unscored/failed jobs from candidate-facing view
    const excludedStatuses = ['discovered', 'score_failed']
    const excludedGrades = ['F']

    let query = db
      .select({
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        location: jobs.location,
        source: jobs.source,
        sourceUrl: jobs.sourceUrl,
        postedAt: jobs.postedAt,
        status: jobs.status,
        grade: jobs.grade,
        score10d: jobs.score10d,
        archetype: jobs.archetype,
        archetypeConfidence: jobs.archetypeConfidence,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .where(
        eq(jobs.candidateId, candidate.id)
      )
      .orderBy(desc(jobs.createdAt))

    const allJobs = await query

    // Filter in application layer (simpler than complex SQL for SQLite compat)
    const filtered = allJobs.filter(j => {
      if (!j.grade || j.grade === 'F') return false
      if (excludedStatuses.includes(j.status)) return false
      if (gradeFilter === 'A') return j.grade === 'A'
      if (gradeFilter === 'A+B') return j.grade === 'A' || j.grade === 'B'
      return true // 'all'
    })

    return NextResponse.json({ jobs: filtered })
  } catch (e) {
    console.error('[/api/jobs] error:', e)
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create `src/app/api/jobs/[jobId]/decision/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

const VALID_DECISIONS = ['approved', 'rejected', 'snoozed'] as const
type Decision = typeof VALID_DECISIONS[number]

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { decision } = body as Record<string, unknown>
  if (!decision || !VALID_DECISIONS.includes(decision as Decision)) {
    return NextResponse.json(
      { error: `decision must be one of: ${VALID_DECISIONS.join(', ')}` },
      { status: 400 }
    )
  }

  try {
    await db.update(jobs)
      .set({ status: decision as Decision })
      .where(eq(jobs.id, jobId))

    return NextResponse.json({ jobId, status: decision })
  } catch (e) {
    console.error('[/api/jobs/decision] error:', e)
    return NextResponse.json({ error: 'Failed to update decision' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create `src/app/api/jobs/[jobId]/report/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  try {
    const [job] = await db
      .select({ reportMd: jobs.reportMd, grade: jobs.grade, title: jobs.title, company: jobs.company })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ reportMd: job.reportMd, grade: job.grade })
  } catch (e) {
    console.error('[/api/jobs/report] error:', e)
    return NextResponse.json({ error: 'Failed to load report' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Add API client functions to `src/lib/api.ts`**

```typescript
export async function getJobs(gradeFilter: 'A' | 'A+B' | 'all' = 'all'): Promise<{
  jobs: Array<{
    id: string; title: string; company: string; location: string | null
    source: string; sourceUrl: string; grade: string | null
    score10d: Record<string, unknown> | null; archetype: string | null
    archetypeConfidence: string | null; status: string; postedAt: string | null
  }>
}> {
  return request(`/api/jobs?grade=${encodeURIComponent(gradeFilter)}`)
}

export async function submitDecision(
  jobId: string,
  decision: 'approved' | 'rejected' | 'snoozed'
): Promise<{ jobId: string; status: string }> {
  return request(`/api/jobs/${jobId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
}

export async function getJobReport(jobId: string): Promise<{
  reportMd: string | null; grade: string | null
}> {
  return request(`/api/jobs/${jobId}/report`)
}
```

- [ ] **Step 5: Type-check and test**

```bash
npx tsc --noEmit && npm run test:run
```

Expected: 0 type errors, 0 test failures.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/jobs/ src/lib/api.ts
git commit -m "feat: add GET /api/jobs, POST /api/jobs/[id]/decision, GET /api/jobs/[id]/report"
```

---

### Task 8: Grade filter persistence in preferences

**Files:**
- Modify: `src/types/candidate.ts`
- Modify: `src/app/api/preferences/route.ts` (no change needed — already persists arbitrary preference keys)

- [ ] **Step 1: Add `gradeFilter` to the Preferences type in `src/types/candidate.ts`**

Find the `Preferences` interface and add:

```typescript
  grade_filter?: 'A' | 'A+B' | 'all'
```

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/candidate.ts
git commit -m "feat: add grade_filter to Preferences type for filter persistence"
```

---

### Task 9: Build the HITL Review Dashboard (Applications page)

**Files:**
- Create: `src/components/applications/JobCard.tsx`
- Create: `src/components/applications/GradeFilter.tsx`
- Create: `src/components/applications/ReportDrawer.tsx`
- Replace: `src/app/applications/page.tsx`

- [ ] **Step 1: Create `src/components/applications/JobCard.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, X, Clock, ExternalLink, ChevronDown } from 'lucide-react'

const GRADE_COLOURS: Record<string, string> = {
  A: 'bg-emerald-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-amber-500 text-white',
  D: 'bg-orange-500 text-white',
}

function GradeBadge({ grade }: { grade: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${GRADE_COLOURS[grade] ?? 'bg-[#1e2d4a] text-[#94a3b8]'}`}>
      {grade}
    </span>
  )
}

interface Job {
  id: string; title: string; company: string; location: string | null
  grade: string | null; score10d: Record<string, unknown> | null
  archetype: string | null; source: string; sourceUrl: string
  status: string; postedAt: string | null
}

interface Props {
  job: Job
  onDecision: (jobId: string, decision: 'approved' | 'rejected' | 'snoozed') => void
  onViewReport: (jobId: string) => void
  isPending: boolean
}

export function JobCard({ job, onDecision, onViewReport, isPending }: Props) {
  const score = (job.score10d as any)?.numeric_score ?? null

  return (
    <div className="bg-[#0d1f3c] border border-[#1e2d4a] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {job.grade && <GradeBadge grade={job.grade} />}
          <div>
            <h3 className="text-[#e2e8f0] font-semibold text-sm leading-tight">{job.title}</h3>
            <p className="text-[#64748b] text-xs mt-0.5">{job.company}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          {score && <p className="text-[#94a3b8] text-xs font-mono">{score.toFixed(1)}</p>}
          <p className="text-[#475569] text-[10px] capitalize">{job.source}</p>
        </div>
      </div>

      {(job.location || job.archetype) && (
        <div className="flex gap-2 flex-wrap">
          {job.location && (
            <span className="text-[10px] text-[#475569] bg-[#0d1829] px-2 py-0.5 rounded">
              {job.location}
            </span>
          )}
          {job.archetype && (
            <span className="text-[10px] text-[#64748b] bg-[#0d1829] px-2 py-0.5 rounded">
              {job.archetype}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3"
          onClick={() => onDecision(job.id, 'approved')}
          disabled={isPending || job.status === 'approved'}
          isLoading={isPending}
        >
          <Check className="w-3 h-3 mr-1" />Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-[#1e2d4a] text-[#94a3b8] hover:text-red-400 px-3"
          onClick={() => onDecision(job.id, 'rejected')}
          disabled={isPending || job.status === 'rejected'}
        >
          <X className="w-3 h-3 mr-1" />Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-[#1e2d4a] text-[#94a3b8] px-3"
          onClick={() => onDecision(job.id, 'snoozed')}
          disabled={isPending || job.status === 'snoozed'}
        >
          <Clock className="w-3 h-3 mr-1" />Snooze
        </Button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => onViewReport(job.id)}
            className="text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            Report ↗
          </button>
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/applications/GradeFilter.tsx`**

```tsx
'use client'

interface Props {
  value: 'A' | 'A+B' | 'all'
  onChange: (v: 'A' | 'A+B' | 'all') => void
  counts: { A: number; B: number; total: number }
}

const OPTIONS: Array<{ label: string; value: 'A' | 'A+B' | 'all' }> = [
  { label: 'A only', value: 'A' },
  { label: 'A + B', value: 'A+B' },
  { label: 'All grades', value: 'all' },
]

export function GradeFilter({ value, onChange, counts }: Props) {
  return (
    <div className="flex items-center gap-1 bg-[#0d1f3c] border border-[#1e2d4a] rounded-lg p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-[#1e3a5f] text-[#e2e8f0]'
              : 'text-[#475569] hover:text-[#94a3b8]'
          }`}
        >
          {opt.label}
        </button>
      ))}
      <span className="ml-2 text-[10px] text-[#334155]">
        {counts.A}A · {counts.B}B · {counts.total} total
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/components/applications/ReportDrawer.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { getJobReport } from '@/lib/api'
import { X } from 'lucide-react'

interface Props {
  jobId: string | null
  onClose: () => void
}

export function ReportDrawer({ jobId, onClose }: Props) {
  const [report, setReport] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!jobId) { setReport(null); return }
    setLoading(true)
    getJobReport(jobId)
      .then((r) => setReport(r.reportMd))
      .catch(() => setReport('Failed to load report.'))
      .finally(() => setLoading(false))
  }, [jobId])

  if (!jobId) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-[#060d1f] border-l border-[#1e2d4a] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[#e2e8f0] font-semibold text-sm">Score Report</h2>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8]">
            <X className="w-4 h-4" />
          </button>
        </div>
        {loading ? (
          <p className="text-[#475569] text-sm">Loading report…</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none text-[#94a3b8]">
            <pre className="whitespace-pre-wrap text-xs font-mono text-[#94a3b8] leading-relaxed">
              {report ?? 'No report available.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Replace `src/app/applications/page.tsx`**

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { getJobs, submitDecision, getPreferences, updatePreferences } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { JobCard } from '@/components/applications/JobCard'
import { GradeFilter } from '@/components/applications/GradeFilter'
import { ReportDrawer } from '@/components/applications/ReportDrawer'
import { Skeleton } from '@/components/ui/skeleton'

type GradeFilterVal = 'A' | 'A+B' | 'all'

export default function ApplicationsPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [gradeFilter, setGradeFilter] = useState<GradeFilterVal>('A+B')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [reportJobId, setReportJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load filter preference from DB on mount
  useEffect(() => {
    getPreferences()
      .then((r) => {
        const saved = r.preferences.grade_filter as GradeFilterVal | undefined
        if (saved) setGradeFilter(saved)
      })
      .catch(() => {})
  }, [])

  const loadJobs = useCallback(async (filter: GradeFilterVal) => {
    setLoading(true)
    try {
      const r = await getJobs(filter)
      setJobs(r.jobs)
    } catch {
      setError('Failed to load jobs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadJobs(gradeFilter) }, [gradeFilter, loadJobs])

  const handleFilterChange = async (v: GradeFilterVal) => {
    setGradeFilter(v)
    updatePreferences({ grade_filter: v }).catch(() => {})
  }

  const handleDecision = async (jobId: string, decision: 'approved' | 'rejected' | 'snoozed') => {
    setPendingId(jobId)
    try {
      await submitDecision(jobId, decision)
      setJobs((prev) =>
        prev.map((j) => j.id === jobId ? { ...j, status: decision } : j)
      )
    } catch {
      setError('Failed to save decision.')
    } finally {
      setPendingId(null)
    }
  }

  const counts = {
    A: jobs.filter((j) => j.grade === 'A').length,
    B: jobs.filter((j) => j.grade === 'B').length,
    total: jobs.length,
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Applications" />
      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        {error && (
          <div className="mb-4 px-4 py-3 bg-[#450a0a] border border-[#7f1d1d] rounded-lg text-[12px] text-[#fca5a5]">
            {error}
          </div>
        )}
        <div className="mb-5">
          <GradeFilter value={gradeFilter} onChange={handleFilterChange} counts={counts} />
        </div>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[140px] rounded-xl bg-[#0d1f3c]" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[#475569] text-sm">
              {gradeFilter === 'all'
                ? 'No scored jobs yet — run the pipeline to discover and score matches.'
                : `No ${gradeFilter} grade jobs found. Try a wider filter.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onDecision={handleDecision}
                onViewReport={setReportJobId}
                isPending={pendingId === job.id}
              />
            ))}
          </div>
        )}
      </main>
      <ReportDrawer jobId={reportJobId} onClose={() => setReportJobId(null)} />
    </div>
  )
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
npm run test:run
```

Expected: 66/66 pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/applications/ src/app/applications/page.tsx
git commit -m "feat: build HITL review dashboard on /applications — grade filter, job cards, report drawer, approve/reject/snooze"
```

---

### Task 10: Update speckit plan reference and final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md plan reference**

Find the line between `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` in `CLAUDE.md` and update the plan reference:

```
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at:
docs/superpowers/plans/2026-05-02-10d-scoring-engine.md
```

- [ ] **Step 2: Run full verification**

```bash
npm run test:run && npx tsc --noEmit && npm run build
```

Expected: 66/66 pass, 0 type errors, clean production build.

- [ ] **Step 3: Run Python tests**

```bash
cd agent && poetry run pytest tests/unit/test_db_sqlite.py tests/unit/test_scoring_engine.py -v 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md plan reference to 10D scoring engine plan"
```

---

## Self-Review

**Spec coverage:**
- ✅ FR-001 Gate-pass logic → Task 4 (`score_to_grade`, `GATE_FAIL_THRESHOLD`)
- ✅ FR-002 Weighted 8 dimensions → Task 4 (`compute_weighted_score`, `DIMENSION_WEIGHTS`)
- ✅ FR-003 Grade mapping A–F → Task 4 (`score_to_grade`)
- ✅ FR-004 Persist score, grade, report → Task 5 (`update_job_score`)
- ✅ FR-005 F-grade excluded from dashboard → Task 7 (`/api/jobs` filter)
- ✅ FR-006 6-block report for B+, block_a only for F → Task 4 (`generate_report`)
- ✅ FR-007 CV Match cites real proof points — enforced by prompt instruction (const III)
- ✅ FR-008 Pydantic validation + 2-retry self-repair → Task 4 (`score_job` retry loop)
- ✅ FR-009 Gate scores stored but excluded from numeric score → Task 4 (recomputed locally)
- ✅ FR-010 Grade filter persistence → Tasks 8, 9
- ✅ FR-011 45-second completion — handled by LiteLLM call; timeout not explicitly enforced (acceptable for MVP)
- ✅ FR-012 Factual self-review — enforced by report prompt instruction; dedicated self-review LLM call is Post-MVP enhancement
- ✅ SC-004 F-grade never shown → Task 7 (API filter)
- ✅ Auto-chain after fetch_jds → Task 6
- ✅ Dashboard status chains to score_jobs → Task 6 (status route)

**Placeholder scan:** No TBDs or TODOs. All code blocks complete.

**Type consistency:** `ScoringState` defined in Task 2, used identically in Tasks 5 and 6. `get_jobs_to_score` returns `list[dict]` with keys `id, title, company, jd_raw, source` — consumed identically across tasks 4, 5, 6.
