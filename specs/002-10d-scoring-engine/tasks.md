# Tasks: 10-Dimension Scoring Engine (F9)

**Input**: Design documents from `specs/002-10d-scoring-engine/`
**Branch**: `002-10d-scoring-engine`
**Date**: 2026-05-02
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data Model**: [data-model.md](data-model.md) | **Contracts**: [contracts/api.md](contracts/api.md)

> **Skill gates embedded below.**
> — Before any implementation task: invoke `superpowers:test-driven-development`
> — Before any PR/completion claim: invoke `superpowers:verification-before-completion`
> — On any bug or test failure: invoke `superpowers:systematic-debugging`
> — On 2+ independent tasks: invoke `superpowers:dispatching-parallel-agents`

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Parallelisable (different files, no unresolved dependencies)
- **[Story]**: Which user story this task serves (US1/US2/US3)
- **TDD gate** 🔴→🟢: Write the failing test first, confirm it fails, then implement

---

## Phase 1: Schema — Add Score Columns to `jobs`

**Purpose**: Extend the `jobs` table with the 5 columns needed to store scoring results. Must complete before any Python or Next.js scoring work can be tested end-to-end.

- [x] T001 Add `Score10D` and `DimensionScore` TypeScript types to `src/db/schema.ts` (at the top, before table definitions) per data-model.md
- [x] T002 Add 5 new columns to the `jobs` pgTable in `src/db/schema.ts`: `score10d jsonb.$type<Score10D>()`, `grade varchar({length:1})`, `reportMd text()`, `archetype text()`, `archetypeConfidence numeric({precision:3,scale:2})`
- [x] T003 Add the same `Score10D`/`DimensionScore` types and 5 columns to the `jobs` sqliteTable in `src/db/schema.sqlite.ts` using SQLite-compatible types: `score10d text({mode:'json'}).$type<Score10D>()`, `grade text()`, `reportMd text()`, `archetype text()`, `archetypeConfidence real()`
- [x] T004 Run `npm run db:generate` — review generated migration for correctness (5 nullable columns on `jobs`)
- [x] T005 Run `npm run db:migrate` — confirm columns added to Neon
- [x] T006 Run `DATABASE_URL=./proxim-dev.db npm run db:generate:sqlite && DATABASE_URL=./proxim-dev.db npm run db:migrate:sqlite` — confirm columns added to `proxim-dev.db`
- [x] T007 Run `npx tsc --noEmit` — zero TypeScript errors after schema additions

**Checkpoint ✅**: `npm run db:studio:sqlite` shows `jobs` table has `grade`, `score_10d`, `report_md`, `archetype`, `archetype_confidence` columns. `npx tsc --noEmit` passes.

---

## Phase 2: Python Models + DB Functions (TDD)

**Purpose**: Add Pydantic state models and DB helper functions before writing any graph logic.

> 🔵 Invoke `superpowers:test-driven-development` before T010.

### 2A — Pydantic Models

- [x] T008 [P] Add `DimensionScore`, `GateScores`, `WeightedScores`, `JobScoreOutput`, `ScoreReport`, `ScoringState` Pydantic models to `agent/agent/models.py` per data-model.md

- [x] T009 [P] Run `cd agent && poetry run python -c "from agent.models import ScoringState, JobScoreOutput, ScoreReport; print('OK')"` — confirm `OK`

### 2B — DB Functions (TDD)

> 🔴→🟢 TDD gate: Write T010 first, confirm tests FAIL, then implement T011 and T012.

- [x] T010 Write failing tests in `agent/tests/unit/test_db_sqlite.py` — add 4 new test functions:
  - `test_get_jobs_to_score_returns_discovered_with_jd` — insert a discovered job with `jd_raw='We are hiring...'`; call `get_jobs_to_score(conn, CANDIDATE_ID)`; assert 1 result with keys `id`, `title`, `company`, `jd_raw`
  - `test_get_jobs_to_score_skips_empty_jd` — insert job with `jd_raw=''`; call `get_jobs_to_score`; assert `result == []`
  - `test_update_job_score_persists_all_fields` — insert job; call `update_job_score(conn, job_id, score_json={}, grade='B', report_md='## Report', archetype='GCC AI Practice Head', archetype_confidence=0.82)`; query DB; assert `grade='B'`, `report_md='## Report'`, `archetype='GCC AI Practice Head'`
  - `test_mark_job_score_failed_sets_status` — insert job; call `mark_job_score_failed(conn, job_id)`; query DB; assert `status='score_failed'`

- [x] T011 Run `cd agent && poetry run pytest tests/unit/test_db_sqlite.py -k "score" -v` — confirm all 4 FAIL 🔴 with `ImportError`

- [x] T012 Add 3 new functions to `agent/agent/db_sqlite.py`:
  - `get_jobs_to_score(pool, candidate_id) -> list[dict]` — `SELECT id, title, company, jd_raw, source FROM jobs WHERE candidate_id=? AND status='discovered' AND jd_raw!='' ORDER BY created_at`
  - `update_job_score(pool, job_id, score_json, grade, report_md, archetype, archetype_confidence) -> None` — `UPDATE jobs SET status='scored', score_10d=?, grade=?, report_md=?, archetype=?, archetype_confidence=?, updated_at=? WHERE id=?` + `pool.commit()`
  - `mark_job_score_failed(pool, job_id) -> None` — `UPDATE jobs SET status='score_failed', updated_at=? WHERE id=?` + `pool.commit()`

- [x] T013 Add the same 3 functions to `agent/agent/db_pg.py` (asyncpg variants using `$1`/`$2` placeholders and `pool.acquire()`)

- [x] T014 Run `cd agent && poetry run pytest tests/unit/test_db_sqlite.py -v` — confirm all tests PASS 🟢 (existing 20 + 4 new = 24 pass)

- [x] T015 Run `cd agent && poetry run python -c "from agent.db_pg import get_jobs_to_score, update_job_score, mark_job_score_failed; print('OK')"` — confirm `OK`

**Checkpoint ✅**: 24 Python DB tests pass. All 3 scoring DB functions importable from both `db_sqlite` and `db_pg`.

---

## Phase 3: Scoring Engine (TDD)

**Purpose**: Implement the deterministic grade computation and LiteLLM scoring call with self-repair retry. These are the core of the feature.

> 🔵 Invoke `superpowers:test-driven-development` before T016.

### 3A — Deterministic Grade Computation (TDD)

> 🔴→🟢 TDD gate: Write T016 first, confirm FAIL, then implement T017.

- [x] T016 Create `agent/tests/unit/test_scoring_engine.py` with 9 unit tests:
  - `test_grade_a_score` — `score_to_grade(4.7, gate_failed=False) == 'A'`
  - `test_grade_b_score` — `score_to_grade(4.2, gate_failed=False) == 'B'`
  - `test_grade_c_score` — `score_to_grade(3.5, gate_failed=False) == 'C'`
  - `test_grade_d_score` — `score_to_grade(2.5, gate_failed=False) == 'D'`
  - `test_grade_f_low_score` — `score_to_grade(1.5, gate_failed=False) == 'F'`
  - `test_grade_f_gate_fail_overrides_high_score` — `score_to_grade(4.9, gate_failed=True) == 'F'`
  - `test_compute_weighted_score_all_fives` — all 8 dims = 5.0 → `compute_weighted_score(scores) == 5.0`
  - `test_compute_weighted_score_all_ones` — all 8 dims = 1.0 → `compute_weighted_score(scores) == 1.0`
  - `test_truncate_jd_over_limit` — 5000-word string → `len(result.split()) <= 4005` and `'truncated' in result`

- [x] T017 Run `poetry run pytest tests/unit/test_scoring_engine.py -v` — confirm all 9 FAIL 🔴 with `ImportError`

- [x] T018 Create `agent/agent/scoring_engine.py` with:
  - `DIMENSION_WEIGHTS: dict[str, int]` — 8 weighted dims with values 3/3/3/2/2/2/2/1 (total 18)
  - `GATE_FAIL_THRESHOLD = 2.5`
  - `MAX_RETRIES = 2`
  - `truncate_jd(jd_text: str, max_words: int = 4000) -> str`
  - `compute_weighted_score(weighted_scores: dict[str, float]) -> float` — `round(sum(score * weight) / TOTAL_WEIGHT, 1)`
  - `score_to_grade(numeric_score: float, gate_failed: bool) -> str` — A≥4.5, B≥4.0, C≥3.0, D≥2.0, else F
  - `_build_scoring_prompt(job, parsed_profile, preferences) -> str` — full 10D prompt with candidate profile, preferences, JD (truncated), and JSON schema instructions
  - `_build_report_prompt(job, parsed_profile, score_output) -> str` — 6-block report prompt with factual integrity instruction
  - `async score_job(job, parsed_profile, preferences) -> JobScoreOutput` — LiteLLM call + Pydantic validate + grade recompute; retry loop up to MAX_RETRIES on ValidationError/JSONDecodeError
  - `async generate_report(job, parsed_profile, score_output) -> ScoreReport` — LiteLLM call for report; block_a only if grade=F

- [x] T019 Run `poetry run pytest tests/unit/test_scoring_engine.py -v` — confirm all 9 PASS 🟢

- [x] T020 Commit: `git add agent/agent/scoring_engine.py agent/tests/unit/test_scoring_engine.py && git commit -m "feat(scoring): add scoring engine — LiteLLM 10D scoring, grade computation, report generation"`

**Checkpoint ✅ Phase 3**: 9 scoring engine tests pass. `compute_weighted_score` and `score_to_grade` are deterministic and fully covered.

---

## Phase 4: Scoring LangGraph

**Purpose**: Wire scoring into the LangGraph pipeline following the established `fetch_jds.py` pattern.

- [x] T021 Create `agent/agent/graphs/scoring.py` with 3 nodes:
  - `load_jobs(state: ScoringState) -> dict` — call `get_jobs_to_score(pool, state.candidate_id)`; log count to pipeline_logs; return `{"jobs_to_score": jobs}`
  - `score_and_report_batch(state: ScoringState) -> dict` — for each job: call `score_job()`, call `generate_report()`, call `update_job_score()` or `mark_job_score_failed()` immediately after each job; log progress `"Scored N/total — Grade X (score) — title @ company"` per job to pipeline_logs; return `{"scored_count": N, "failed_count": M, "skipped_count": K}`
  - `write_score_summary(state: ScoringState) -> dict` — call `update_pipeline_run()` + `update_pipeline_job_status('completed')`; log summary; handle exceptions with last-resort `update_pipeline_job_status('failed')`
  - Wire: `StateGraph(ScoringState)` → `load_jobs → score_and_report_batch → write_score_summary → END`; export `scoring_graph = build_scoring_graph()`

- [x] T022 Run `cd agent && poetry run python -c "from agent.graphs.scoring import scoring_graph; print('Nodes:', list(scoring_graph.nodes))"` — confirm output includes `load_jobs`, `score_and_report_batch`, `write_score_summary`

- [x] T023 Modify `write_fetch_summary` in `agent/agent/graphs/fetch_jds.py` — after `update_pipeline_job_status('completed')`, call `get_jobs_to_score(pool, candidate_id)`; if result is non-empty, call `queue_pipeline_job(pool, candidate_id, 'score_jobs')` and log `"Queuing scoring for N jobs…"`

- [x] T024 Modify `agent/agent/daemon.py` `_dispatch_job` function — add `elif job['job_type'] == 'score_jobs':` branch that imports `scoring_graph` and `ScoringState`, creates state, calls `await scoring_graph.ainvoke(state)`

- [x] T025 Modify `src/app/api/pipeline/[jobId]/status/route.ts` — extend `followUpJobId` logic to also detect queued/running `score_jobs` when `jobType == 'fetch_jds'`; update the loop to check `['fetch_jds', 'score_jobs']` from `discovery_only` and `['score_jobs']` from `fetch_jds`

- [x] T026 Run `cd agent && poetry run python -c "from agent.daemon import main; print('daemon OK')" 2>&1 | grep daemon` — confirm `daemon OK`

- [x] T027 Run `cd agent && poetry run pytest tests/unit/ -q` — confirm same pass count as before (no regressions)

- [x] T028 Run `npm run test:run && npx tsc --noEmit` — 0 failures, 0 type errors

- [x] T029 Commit: `git add agent/agent/graphs/scoring.py agent/agent/graphs/fetch_jds.py agent/agent/daemon.py src/app/api/pipeline/\[jobId\]/status/route.ts && git commit -m "feat(scoring): add scoring LangGraph, auto-chain from fetch_jds, daemon dispatch, status API chains to score_jobs"`

**Checkpoint ✅ Phase 4**: Full pipeline chain works: `discovery_only → fetch_jds → score_jobs`. Daemon dispatches all three job types.

---

## Phase 5: Next.js API Routes (TDD)

**Purpose**: Expose scored job data to the dashboard via three new Route Handlers.

> 🔵 Invoke `superpowers:test-driven-development` before T031.

> 🔴→🟢 TDD gate: Write T030 tests first, confirm FAIL, then implement T031–T033.

- [x] T030 [P] [US1] Write failing tests in `src/__tests__/api/jobs/jobs.test.ts`:
  - Mock Drizzle `db` module
  - `test_returns_empty_when_no_scored_jobs` — mock returns `[]`; call `GET /api/jobs`; assert `{ jobs: [] }`
  - `test_filters_f_grade_jobs` — mock returns job with `grade='F'`; assert response `jobs` is empty
  - `test_returns_200_with_scored_job` — mock returns job with `grade='A'`; assert job appears in response

- [x] T031 Run `npm run test:run` — confirm new tests FAIL 🔴 with "Cannot find module"

- [x] T032 [US1] Create `src/app/api/jobs/route.ts` — `GET` handler: call `getOrCreateCandidate()`; query `jobs` table filtering by `candidateId`; filter in application layer to exclude F-grade and `discovered`/`score_failed` status; apply `grade` query param filter (`A` | `A+B` | `all`); return `{ jobs: [...] }` with selected columns only

- [x] T033 [US2] Create `src/app/api/jobs/[jobId]/decision/route.ts` — `POST` handler: validate `decision` is one of `approved`/`rejected`/`snoozed`; `db.update(jobs).set({status: decision}).where(eq(jobs.id, jobId))`; return `{ jobId, status: decision }`

- [x] T034 [P] [US2] Create `src/app/api/jobs/[jobId]/report/route.ts` — `GET` handler: select `reportMd` and `grade` from jobs where `id=jobId`; return `{ reportMd, grade }`; 404 if not found

- [x] T035 Add 3 API client functions to `src/lib/api.ts`:
  - `getJobs(gradeFilter: 'A' | 'A+B' | 'all') -> Promise<{jobs: [...]}>` — `request('/api/jobs?grade=...')`
  - `submitDecision(jobId, decision) -> Promise<{jobId, status}>` — `POST /api/jobs/{jobId}/decision`
  - `getJobReport(jobId) -> Promise<{reportMd, grade}>` — `GET /api/jobs/{jobId}/report`

- [x] T036 Run `npm run test:run` — confirm new tests PASS 🟢 (existing 66 + new)

- [x] T037 Run `npx tsc --noEmit` — zero errors

- [x] T038 Commit: `git add src/app/api/jobs/ src/lib/api.ts src/__tests__/api/jobs/ && git commit -m "feat(scoring): add GET /api/jobs, POST /api/jobs/[id]/decision, GET /api/jobs/[id]/report"`

---

## Phase 6: Grade Filter Persistence + Applications Dashboard (US3)

**Purpose**: Build the HITL review dashboard on `/applications` and persist the grade filter to candidate preferences.

> 🔵 Invoke `superpowers:test-driven-development` before T041.

### 6A — Type Extension

- [x] T039 [P] Add `grade_filter?: 'A' | 'A+B' | 'all'` to the `Preferences` interface in `src/types/candidate.ts`

- [x] T040 [P] Run `npx tsc --noEmit` — zero errors

### 6B — UI Components (TDD)

> 🔴→🟢 TDD gate: Write T041 before implementing T042–T045.

- [x] T041 [US3] Write failing tests in `src/__tests__/components/applications/JobCard.test.tsx`:
  - `test_renders_grade_badge` — render `<JobCard>` with `grade='A'`; assert badge with text "A" is visible
  - `test_renders_company_and_title` — assert company name and title text visible
  - `test_approve_button_calls_onDecision` — click Approve; assert `onDecision` called with `('job-id', 'approved')`
  - `test_disabled_when_pending` — pass `isPending=true`; assert Approve button is disabled

- [x] T042 Run `npm run test:run` — confirm new tests FAIL 🔴 with "Cannot find module"

- [x] T043 [P] [US3] Create `src/components/applications/JobCard.tsx` — job card with: grade badge coloured by A=green/B=blue/C=amber/D=orange; numeric score; title + company; location + archetype pills; Approve/Reject/Snooze buttons (disabled when `isPending`); "Report ↗" link; external link icon

- [x] T044 [P] [US3] Create `src/components/applications/GradeFilter.tsx` — pill toggle for `A` / `A+B` / `all` with job counts display

- [x] T045 [P] [US3] Create `src/components/applications/ReportDrawer.tsx` — slide-in drawer; loads `getJobReport(jobId)` on mount; renders `reportMd` as `<pre>` (mono text); close button; click-outside-to-close

### 6C — Applications Page

- [x] T046 [US3] Replace `src/app/applications/page.tsx` with full HITL review dashboard:
  - On mount: load `grade_filter` from `getPreferences()` and `setGradeFilter` accordingly
  - Load jobs via `getJobs(gradeFilter)` on mount and on filter change
  - Render `<GradeFilter>` with counts (A/B/total)
  - Render grid of `<JobCard>` components
  - Handle `onDecision` → call `submitDecision()` → optimistically update job status in local state
  - Handle `onViewReport` → open `<ReportDrawer>` with the job's ID
  - Persist filter change via `updatePreferences({ grade_filter: v })`
  - Empty state message when 0 jobs (with hint to widen filter or run pipeline)

- [x] T047 Run `npm run test:run` — confirm all tests PASS 🟢 (including new JobCard tests)

- [x] T048 Run `npx tsc --noEmit` — zero errors

- [x] T049 Commit: `git add src/app/applications/ src/components/applications/ src/types/candidate.ts && git commit -m "feat(scoring): build HITL review dashboard — grade filter, job cards, approve/reject/snooze, report drawer"`

---

## Phase 7: Polish & Verification

**Purpose**: End-to-end validation and production build sign-off.

> 🔵 Invoke `superpowers:verification-before-completion` at T055 before final commit.

- [x] T050 [P] Verify daemon logs show per-job scoring progress: start daemon, trigger `score_jobs` manually via curl, watch terminal for `"Scored 1/N — B (4.2) — Director of AI @ Acme"` entries
- [x] T051 [P] Verify pipeline log pane shows all three phases in one continuous log stream: discovery logs + JD fetch logs + scoring logs (no clearing between phases)
- [x] T052 [P] Verify `/applications` grade filter persists: set to "A only", reload page, confirm filter still shows "A only"
- [x] T053 [P] Verify F-grade jobs never appear on `/applications`: check DB for any `grade='F'` jobs; confirm they are absent from the dashboard even when "All" filter is selected
- [x] T054 Run full Python test suite: `cd agent && poetry run pytest tests/unit/ -v --cov=agent --cov-report=term-missing` — all tests pass
- [x] T055 🔵 **Invoke `superpowers:verification-before-completion`** — run `npm run test:run` (0 failures) + `npx tsc --noEmit` (0 errors) + `npm run build` (exit 0, no prerender errors); show evidence before proceeding
- [x] T056 Final commit: `git add -A && git commit -m "feat: 10D scoring engine — F9 complete"`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Schema)
    └─► Phase 2 (Python Models + DB Functions)
              ├─► Phase 3 (Scoring Engine — TDD)
              │       └─► Phase 4 (Scoring LangGraph)
              └─► Phase 5 (Next.js API Routes — TDD) ← can start after Phase 1
                      └─► Phase 6 (Dashboard)
                              └─► Phase 7 (Polish)
```

### Parallel Opportunities

- **Phase 2 + Phase 5** can start in parallel after Phase 1 completes (different files, no dependency)
- **Within Phase 6**: T043, T044, T045 (JobCard, GradeFilter, ReportDrawer) are fully parallel — different files
- **Phase 7 smoke tests** T050–T053 are parallel (different concerns)

### User Story Mapping

| User Story | Tasks | Phase |
|---|---|---|
| US1 — Automatic job scoring | T001–T029 | 1–4 |
| US2 — 6-block report for B+ jobs | T030–T038 | 5 |
| US3 — Grade filter persistence | T039–T049 | 6 |

---

## Task Tracker Summary

| Phase | Tasks | Status |
|---|---|---|
| Phase 1: Schema | T001–T007 | ⬜ |
| Phase 2: Models + DB | T008–T015 | ⬜ |
| Phase 3: Scoring Engine (TDD) | T016–T020 | ⬜ |
| Phase 4: Scoring LangGraph | T021–T029 | ⬜ |
| Phase 5: Next.js API Routes (TDD) | T030–T038 | ⬜ |
| Phase 6: Dashboard | T039–T049 | ⬜ |
| Phase 7: Polish & Verification | T050–T056 | ⬜ |
| **Total** | **T001–T056** | **0/56** |

---

## Superpowers Skill Gate Summary

| Gate | When | Task ref |
|---|---|---|
| `superpowers:test-driven-development` | Before T010 (DB function tests) | Phase 2 |
| `superpowers:test-driven-development` | Before T016 (scoring engine tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T030 (API route tests) | Phase 5 |
| `superpowers:test-driven-development` | Before T041 (JobCard component tests) | Phase 6 |
| `superpowers:systematic-debugging` | On any test failure or unexpected behaviour | Any phase |
| `superpowers:dispatching-parallel-agents` | T043+T044+T045 in parallel (Phase 6); T050+T051+T052 in parallel (Phase 7) | Phases 6, 7 |
| `superpowers:verification-before-completion` | Before T056 (final commit) | Phase 7 |
