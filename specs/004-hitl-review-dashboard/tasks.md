# Tasks: HITL Review Dashboard (F4)

**Input**: Design documents from `specs/004-hitl-review-dashboard/`
**Branch**: `004-hitl-review-dashboard`
**Date**: 2026-05-04
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data Model**: [data-model.md](data-model.md) | **Contracts**: [contracts/api.md](contracts/api.md) | **Research**: [research.md](research.md)

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

## Phase 1: Setup — Schema + Migrations

**Purpose**: Add `hitl_checkpoints` table to both Drizzle schemas; add `hitlGradeFilter` + `hitlSort` to preferences type. These are prerequisites for ALL user story phases.

- [x] T001 Add `hitlCheckpointStatusEnum` pgEnum to `src/db/schema.ts`: values `awaiting`, `approved`, `rejected`, `snoozed`
- [x] T002 Add `hitlCheckpoints` table to `src/db/schema.ts` per data-model.md: columns `id` (uuid PK), `jobId` (uuid FK → jobs, unique), `candidateId` (uuid FK → candidates), `status` (hitlCheckpointStatusEnum default `awaiting`), `decisionType` (text nullable), `snoozedUntil` (timestamp nullable), `decidedAt` (timestamp nullable), `createdAt` (timestamp defaultNow); add indexes on `(candidateId, status)` and `jobId`; add `uniqueIndex` on `jobId`
- [x] T003 [P] Add `hitlCheckpoints` table to `src/db/schema.sqlite.ts` per data-model.md using SQLite types: `id` text PK, `job_id` text unique FK, `candidate_id` text FK, `status` text default `'awaiting'`, `decision_type` text, `snoozed_until` text, `decided_at` text, `created_at` text defaultFn now; add same indexes
- [x] T004 [P] Extend `Preferences` interface in `src/types/candidate.ts`: add `hitl_grade_filter?: 'A' | 'A+B' | 'all'` (default `'A+B'`) and `hitl_sort?: 'score' | 'date' | 'company'` (default `'score'`)
- [x] T005 Run `npm run db:generate` — review generated migration in `migrations/`; run `npm run db:generate:sqlite`; confirm both migration files are correct
- [x] T006 Apply SQLite migration: run `npm run db:migrate:sqlite`; confirm `hitl_checkpoints` table created in `proxim-dev.db` by running `python -c "import sqlite3; c=sqlite3.connect('proxim-dev.db'); print(c.execute(\"SELECT name FROM sqlite_master WHERE name='hitl_checkpoints'\").fetchone())"`
- [x] T007 Apply Neon migration via MCP `mcp__neon__run_sql`: read generated `.sql` migration file; execute each statement separately against project `soft-glade-88914165`; record migration hash in `__drizzle_migrations`; verify with `SELECT table_name FROM information_schema.tables WHERE table_name='hitl_checkpoints'`
- [x] T008 [P] Export `HitlCheckpoint` type from `src/db/schema.ts` (already inferred via `typeof hitlCheckpoints.$inferSelect`); also export from `src/db/schema.sqlite.ts` — ensure both types are importable by route handlers
- [x] T009 Run `npx tsc --noEmit` — confirm zero TypeScript errors after schema additions

**Checkpoint ✅**: `hitl_checkpoints` table exists in both SQLite and Neon; TypeScript clean; `HitlCheckpoint` type exported.

---

## Phase 2: Foundational — API Client + Shared Logic

**Purpose**: Shared API client functions, DB helper functions, and `CandidateSidebar` nav update that all user story phases depend on.

> ⚠️ **CRITICAL**: No user story work can begin until this phase is complete.

- [x] T065 [P] Create `src/lib/score-helpers.ts`: export `extractStrengthsAndRisks(score10d: Score10D | null): { strengths: Array<{name: string; score: number}>; risks: Array<{name: string; score: number}> }` — maps all 10 dimension scores, sorts descending, returns top-3 as strengths and bottom-2 weighted dimensions as risks; export `DIMENSION_LABELS: Record<string, string>` mapping raw dimension keys to readable names (e.g. `"interviewProbability"` → `"Interview Probability"`)
- [x] T066 [P] Create `src/lib/hitl-checkpoint.ts`: export `upsertHitlCheckpoint(db, { jobId, candidateId, status, decisionType, snoozedUntil, decidedAt }: HitlCheckpointInput) -> Promise<string>` — uses Drizzle `insert(...).onConflictDoUpdate(target: jobId, set: { status, decisionType, snoozedUntil, decidedAt })` so that `uniqueIndex` on `jobId` allows upsert without duplicate key errors; returns the checkpoint `id`; used by approve/reject/snooze routes instead of inline Drizzle calls
- [x] T067 [P] Add PostgreSQL equivalents to `agent/agent/db_pg.py`: `get_snoozed_jobs_to_resurface(pool) -> list[dict]` using asyncpg `SELECT ... WHERE snoozed_until <= now()`; `resurface_snoozed_job(pool, checkpoint_id: str, job_id: str)` using asyncpg UPDATE; mirror the SQLite implementations exactly, using `$1` placeholders instead of `?`
- [x] T010 [P] Add to `src/lib/api.ts`: `getCandidateJobs(candidateId: string, filter?: string, sort?: string)` → `GET /api/candidates/[id]/jobs?filter=&sort=`; `approveJob(jobId: string, candidateId: string)` → `POST /api/jobs/[jobId]/approve?candidateId=`; `rejectJob(jobId: string, candidateId: string)` → `POST /api/jobs/[jobId]/reject?candidateId=`; `snoozeJob(jobId: string, candidateId: string, days?: number)` → `POST /api/jobs/[jobId]/snooze?candidateId=`
- [x] T011 [P] Add `export type HitlJob` to `src/lib/api.ts`: `{ id, title, company, location, source, sourceUrl, postedAt, status, grade, numericScore, score10d, reportMd, archetype, archetypeConfidence, hitlCheckpoint: { id, status, snoozedUntil, createdAt } | null }`
- [x] T010 [P] Update `src/components/layout/CandidateSidebar.tsx`: change `Pipeline` nav item from `soon: true` to active (remove `soon` flag); update href stays at `${base}/pipeline`
- [x] T011 Add to `agent/agent/db_sqlite.py`: `get_snoozed_jobs_to_resurface(pool) -> list[dict]` — SELECT hitl_checkpoints JOIN jobs WHERE `hc.status='snoozed' AND hc.snoozed_until <= datetime('now')`; `resurface_snoozed_job(pool, checkpoint_id: str, job_id: str)` — UPDATE hitl_checkpoints SET status='awaiting', snoozed_until=NULL; UPDATE jobs SET status='awaiting'
- [x] T012 Modify `agent/agent/daemon.py`: add secondary coroutine `_snooze_resurface_loop(pool)` that runs `asyncio.sleep(60)` then calls `get_snoozed_jobs_to_resurface(pool)` and `resurface_snoozed_job()` for each result; start this coroutine in `main()` alongside the main polling loop via `asyncio.gather`
- [x] T013 Run `npx tsc --noEmit` — confirm zero TypeScript errors

**Checkpoint ✅ Foundation Ready**: API client functions defined, sidebar Pipeline link active, snooze resurface loop wired in daemon.

---

## Phase 3: User Story 1 — Review and Approve a Scored Job (Priority: P1) 🎯 MVP

**Goal**: The candidate sees scored jobs on the Pipeline page with grade badges, reads the inline score report, and approves/rejects/snoozes. Approve atomically enqueues resume generation.

**Independent Test**: Insert a fixture scored job with grade=A; load `/candidates/[id]/pipeline`; verify the job card shows grade badge + score; click Approve; assert `jobs.status='approved'`, `hitl_checkpoints.status='approved'`, and a new `pipeline_jobs` row exists with `job_type='resume_builder'`.

> 🔵 Invoke `superpowers:test-driven-development` before T015, T022, T027.

### 3A — Job List API

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T015.

- [x] T014 [P] [US1] Write failing tests in `src/__tests__/api/hitl/jobs.test.ts`: `test_returns_200_with_scored_and_awaiting_jobs`; `test_excludes_f_grade_jobs`; `test_excludes_discovered_and_score_failed`; `test_applies_grade_filter_A_only`; `test_applies_grade_filter_A_plus_B` — mock Drizzle, fixture jobs with various grades/statuses
- [x] T015 [US1] Run `npm run test:run -- --testPathPattern=hitl/jobs` — confirm all FAIL 🔴
- [x] T016 [US1] Create `src/app/api/candidates/[id]/jobs/route.ts`: `GET` handler; read `filter` (default `'A+B'`) and `sort` (default `'score'`) query params; query `jobs LEFT JOIN hitl_checkpoints` WHERE `candidateId=?` AND `grade != 'F'` AND `status NOT IN ('discovered','score_failed','rejected')`; apply grade filter (`A`=grade A only, `A+B`=A and B, `all`=A/B/C/D); sort by `numericScore DESC` | `postedAt DESC` | `company ASC`; return `{ jobs: HitlJob[], total: number }`
- [x] T017 [US1] Run `npm run test:run -- --testPathPattern=hitl/jobs` — confirm all PASS 🟢

### 3B — Decision API Routes (Approve / Reject / Snooze)

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T022.

- [x] T069 [US1] Update `src/app/api/jobs/[jobId]/approve/route.ts`, `reject/route.ts`, `snooze/route.ts` to import and use `upsertHitlCheckpoint` from `src/lib/hitl-checkpoint.ts` instead of inline Drizzle INSERT — reduces code duplication across three routes, ensures consistent checkpoint upsert logic
- [x] T018 [P] [US1] Write failing tests in `src/__tests__/api/hitl/approve.test.ts`: `test_approve_returns_200_with_pipeline_job_id`; `test_approve_creates_hitl_checkpoint`; `test_approve_returns_409_when_already_decided`; `test_approve_returns_409_on_concurrent_double_approve` (simulate 0 rows affected from conditional UPDATE); `test_approve_returns_422_when_not_awaiting_or_scored` — mock Drizzle
- [x] T019 [P] [US1] Write failing tests in `src/__tests__/api/hitl/reject.test.ts`: `test_reject_returns_200`; `test_reject_updates_status_to_rejected`; `test_reject_returns_409_when_already_decided`
- [x] T020 [P] [US1] Write failing tests in `src/__tests__/api/hitl/snooze.test.ts`: `test_snooze_returns_200_with_snoozed_until`; `test_snooze_sets_snoozed_until_7_days_ahead`; `test_snooze_returns_409_when_already_decided`
- [x] T021 [US1] Run `npm run test:run -- --testPathPattern=hitl/(approve|reject|snooze)` — confirm all FAIL 🔴
- [x] T022 [US1] Create `src/app/api/jobs/[jobId]/approve/route.ts`: `POST` handler; conditional UPDATE `jobs SET status='approved' WHERE id=? AND status IN ('scored','awaiting')`; if 0 rows affected → 409; INSERT `hitl_checkpoints (jobId, candidateId, status='approved', decisionType='approve', decidedAt=now())`; INSERT `pipeline_jobs (jobType='resume_builder', candidateId, payload={job_id, candidate_id})`; return `{ jobId, status, pipelineJobId, checkpointId }`
- [x] T023 [US1] Create `src/app/api/jobs/[jobId]/reject/route.ts`: `POST` handler; conditional UPDATE `jobs SET status='rejected' WHERE id=? AND status IN ('scored','awaiting','snoozed')`; if 0 rows affected → 409; UPSERT `hitl_checkpoints` with `status='rejected'`, `decidedAt=now()`; return `{ jobId, status, checkpointId }`
- [x] T024 [US1] Create `src/app/api/jobs/[jobId]/snooze/route.ts`: `POST` handler; read `days` from body (default 7); compute `snoozedUntil = new Date(Date.now() + days * 86400000)`; conditional UPDATE `jobs SET status='snoozed' WHERE id=? AND status IN ('scored','awaiting')`; if 0 rows affected → 409; UPSERT `hitl_checkpoints` with `status='snoozed'`, `snoozedUntil`; return `{ jobId, status, snoozedUntil, checkpointId }`
- [x] T025 [US1] Run `npm run test:run -- --testPathPattern=hitl/(approve|reject|snooze)` — confirm all PASS 🟢

### 3C — UI Components

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T027.

- [x] T026 [P] [US1] Write failing component tests in `src/__tests__/components/pipeline/JobReviewCard.test.tsx`: `test_renders_grade_badge_with_correct_colour`; `test_renders_numeric_score`; `test_renders_company_and_title`; `test_approve_button_calls_onApprove`; `test_reject_button_calls_onReject`; `test_snooze_button_calls_onSnooze`; `test_expand_toggle_shows_report_pane`
- [x] T027 [US1] Run `npm run test:run -- --testPathPattern=pipeline/JobReviewCard` — confirm all FAIL 🔴
- [x] T028 [P] [US1] Create `src/components/pipeline/StrengthRiskChips.tsx`: imports `extractStrengthsAndRisks` from `src/lib/score-helpers.ts`; accepts `score10d: Score10D | null`; renders top-3 strengths as shadcn `Badge` in teal and top-2 risks in amber; each badge shows the readable dimension label (from `DIMENSION_LABELS`) + score formatted as `"Interview Probability · 4.8"`; returns `null` if `score10d` is null
- [x] T029 [P] [US1] Create `src/components/pipeline/ScoreReportPane.tsx`: accepts `reportMd: string | null`, `isOpen: boolean`, `onToggle: () => void`; toggle button with "View Report ↓" / "Hide Report ↑" using shadcn `Button`; renders `reportMd` as formatted markdown using Tailwind prose classes when open; falls back to plain `<pre>` if markdown parsing fails (FR spec edge case)
- [x] T030 [US1] Create `src/components/pipeline/JobReviewCard.tsx`: accepts `job: HitlJob`, `candidateId: string`, `onApprove`, `onReject`, `onSnooze` callbacks, `isPending: boolean`; uses shadcn `Card`, `Button`, `Badge`; shows: grade badge (A=emerald, B=blue, C=amber, D=orange — F never shown), numeric score, company+title, source, postedAt; renders `StrengthRiskChips`; includes `ScoreReportPane` toggle; Approve/Reject/Snooze `Button` row; snoozed card shows amber "Snoozed until [date]" badge; rejected cards never appear
- [x] T031 [US1] Run `npm run test:run -- --testPathPattern=pipeline/JobReviewCard` — confirm all PASS 🟢
- [x] T032 [P] [US1] Create `src/components/pipeline/PipelineFilterBar.tsx`: three toggle buttons "A only" / "A + B" / "All (C/D)"; active state highlighted with shadcn `Button` variant; `onChange(filter)` callback; persists selection via `updatePreferences({ hitl_grade_filter: filter })` on change
- [x] T033 [P] [US1] Create `src/components/pipeline/PipelineSortControl.tsx`: shadcn `DropdownMenu` with three options: "Score (highest first)" / "Posted Date (newest)" / "Company (A–Z)"; `onChange(sort)` callback; persists via `updatePreferences({ hitl_sort: sort })`

### 3D — Pipeline Page

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T034.

- [x] T034 [US1] Replace `src/app/candidates/[id]/pipeline/page.tsx`: `'use client'`; reads `candidateId` from `useParams()`; on mount loads `getPreferences(candidateId)` to restore `hitl_grade_filter` + `hitl_sort`; calls `getCandidateJobs(candidateId, filter, sort)` to populate job list; renders `PipelineFilterBar` + `PipelineSortControl` in `Topbar` actions; renders grid of `JobReviewCard` components; `handleApprove(jobId)` calls `approveJob`, updates local state to `approved`, shows success toast; `handleReject(jobId)` calls `rejectJob`, removes card from list; `handleSnooze(jobId)` calls `snoozeJob`, removes card from list (resurfaces after 7d); 409 errors show "Already decided — refreshing..." toast + reload; uses `Skeleton` during loading; empty state: "No matching jobs — try a wider filter or run the pipeline"
- [x] T035 [US1] Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T036 [US1] Run `npm run test:run` — all 77+ tests pass

**Checkpoint ✅ US1**: Open `/candidates/[id]/pipeline` → see scored job cards → Approve one → verify `pipeline_jobs` row created in DB Studio → job card shows "Approved" state.

---

## Phase 4: User Story 2 — Pipeline State Persists Across Restarts (Priority: P2)

**Goal**: `awaiting` HITL checkpoints survive a Python agent service restart. Snoozed jobs resurface automatically after 7 days.

**Independent Test**: Insert a fixture `hitl_checkpoints` row with `status='awaiting'`; restart the daemon; verify the job still appears as `awaiting` on the dashboard. Insert a snoozed checkpoint with `snoozed_until` in the past; wait up to 60s for daemon resurface; verify job reappears as `awaiting`.

> 🔵 Invoke `superpowers:test-driven-development` before T038.

### 4A — DB Layer Tests (Python)

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T038.

- [x] T037 Write failing tests in `agent/tests/unit/test_db_hitl.py`: `test_get_snoozed_jobs_returns_expired_snoozes`; `test_get_snoozed_jobs_excludes_future_snoozes`; `test_resurface_snoozed_job_updates_status_to_awaiting`; `test_resurface_clears_snoozed_until` — use in-memory SQLite fixture with `hitl_checkpoints` and `jobs` tables
- [x] T038 Run `poetry run pytest agent/tests/unit/test_db_hitl.py -v` — confirm all FAIL 🔴
- [x] T039 [US2] Implement `get_snoozed_jobs_to_resurface(pool) -> list[dict]` and `resurface_snoozed_job(pool, checkpoint_id: str, job_id: str)` in `agent/agent/db_sqlite.py` (already declared in Phase 2 — add full implementation now if stub was used)
- [x] T040 [US2] Run `poetry run pytest agent/tests/unit/test_db_hitl.py -v` — confirm all PASS 🟢

### 4B — Snooze Resurface Daemon Loop

- [x] T041 [US2] Write failing test in `agent/tests/unit/test_daemon_snooze.py`: `test_snooze_resurface_loop_calls_resurface_for_expired_items` — mock `get_snoozed_jobs_to_resurface` to return 1 job, assert `resurface_snoozed_job` is called once; `test_snooze_resurface_loop_does_nothing_when_no_expired` — mock returns empty list, assert resurface NOT called
- [x] T042 [US2] Run `poetry run pytest agent/tests/unit/test_daemon_snooze.py -v` — confirm all FAIL 🔴
- [x] T043 [US2] Fully implement `_snooze_resurface_loop` coroutine in `agent/agent/daemon.py` (already skeleton from Phase 2): loop indefinitely with `asyncio.sleep(60)`; call `get_snoozed_jobs_to_resurface(pool)`; for each expired job call `resurface_snoozed_job(pool, ...)`; log each resurface with `structlog.info("snooze_resurfaced", job_id=..., checkpoint_id=...)`; catch + log exceptions without stopping the loop
- [x] T044 [US2] Run `poetry run pytest agent/tests/unit/test_daemon_snooze.py -v` — confirm all PASS 🟢

### 4C — Checkpoint Recovery Verification

- [x] T045 [US2] Write failing test in `src/__tests__/api/hitl/jobs.test.ts` (append): `test_awaiting_jobs_visible_after_service_restart` — insert fixture `hitl_checkpoints` with `status='awaiting'`; call GET `/api/candidates/[id]/jobs`; assert job appears with `hitlCheckpoint.status='awaiting'`
- [x] T046 [US2] Run `npm run test:run -- --testPathPattern=hitl/jobs` — confirm PASS 🟢 (new test should pass since GET route already joins `hitl_checkpoints`)
- [x] T047 [US2] Run `poetry run pytest agent/tests/ -v` — all Python tests pass

**Checkpoint ✅ US2**: Start daemon; snooze a job; update `snoozed_until` to past in DB Studio; wait 60s; verify job reappears on dashboard.

---

## Phase 5: User Story 3 — Real-Time Job Arrival Notification (Priority: P3)

**Goal**: New scored jobs appear on the open Pipeline page within 5 seconds via SSE — no page refresh needed.

**Independent Test**: Open Pipeline page in browser; insert a new scored job directly into the DB; verify a new job card appears within 5 seconds without page reload.

> 🔵 Invoke `superpowers:test-driven-development` before T050.

### 5A — SSE Endpoint

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T050.

- [x] T048 [P] [US3] Write failing tests in `src/__tests__/api/hitl/stream.test.ts`: `test_stream_returns_text_event_stream_content_type`; `test_stream_emits_jobs_arrived_when_new_job_exists`; `test_stream_includes_job_ids_in_event_data` — mock Drizzle to return a new job on first poll; use `ReadableStream` API test helpers
- [x] T049 [US3] Run `npm run test:run -- --testPathPattern=hitl/stream` — confirm all FAIL 🔴
- [x] T050 [US3] Create `src/app/api/candidates/[id]/jobs/stream/route.ts`: `GET` handler; reads `candidateId` from params; creates `ReadableStream` that polls `jobs WHERE candidateId=? AND status NOT IN ('discovered','score_failed','rejected') AND grade != 'F' AND createdAt > lastSeen` every 5 seconds; on new jobs → push `event: jobs_arrived\ndata: {"count": N, "jobIds": [...]}\n\n`; after 60s with no new jobs → push `event: idle\ndata: {}\n\n` and close; return `Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } })`
- [x] T051 [US3] Run `npm run test:run -- --testPathPattern=hitl/stream` — confirm all PASS 🟢

### 5B — Client-Side SSE Integration

- [x] T070 [P] [US3] Write failing tests in `src/__tests__/api/hitl/stream.test.ts` (append): `test_stream_closes_after_idle_timeout` — mock DB to return no new jobs for 60s check; assert `idle` event is emitted; `test_stream_only_emits_non_f_grade_jobs` — mock DB with F-grade job; assert no `jobs_arrived` event
- [x] T071 [US3] Run `npm run test:run -- --testPathPattern=hitl/stream` — confirm new tests pass (may need implementation adjustment if idle logic not yet in place)
- [x] T052 [US3] Add `startJobStream(candidateId: string, onJobsArrived: (jobIds: string[]) => void, onIdle: () => void): () => void` to `src/lib/api.ts`: creates `EventSource`; listens for `jobs_arrived` → calls `onJobsArrived(data.jobIds)`; listens for `idle` → closes EventSource, calls `onIdle()`; `onerror` → closes and calls `onIdle()` (caller reconnects); returns cleanup function `() => eventSource.close()`
- [x] T053 [US3] Update `src/app/candidates/[id]/pipeline/page.tsx`: in `useEffect`, call `startJobStream(candidateId, handleJobsArrived, handleStreamIdle)`; `handleJobsArrived` → shows toast "N new jobs arrived!" and calls `loadJobs(filter, sort)` to refresh; `handleStreamIdle` → reconnects after 3s via `setTimeout(() => { reconnect() }, 3000)`; cleanup on component unmount; track connection state with `isStreamConnected` indicator in Topbar subtitle
- [x] T054 [US3] Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T055 [US3] Run `npm run test:run` — all tests pass

**Checkpoint ✅ US3**: Open Pipeline page → insert scored job in DB Studio → within 5s a toast appears and new job card renders — no page refresh.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Observability, grade filter persistence, sort persistence, final verification.

> 🔵 Invoke `superpowers:verification-before-completion` at T062 before final commit.

- [ ] T056 [P] Add `structlog` logging to all three decision routes (`approve`, `reject`, `snooze`): log `job_id`, `candidate_id`, `decision`, `previous_status`, duration at INFO; log 409 conflicts at WARNING
- [x] T057 [P] Add `data-testid` attributes to key elements in `JobReviewCard.tsx` (`data-testid="grade-badge"`, `data-testid="approve-btn"`, `data-testid="reject-btn"`, `data-testid="snooze-btn"`, `data-testid="report-toggle"`) for future E2E tests
- [x] T058 [P] Verify grade filter and sort preferences are persisted: in `PipelineFilterBar.tsx` ensure `updatePreferences({ hitl_grade_filter: filter }, candidateId)` is called; in `PipelineSortControl.tsx` ensure `updatePreferences({ hitl_sort: sort }, candidateId)` is called; both use existing `updatePreferences` from `@/lib/api`
- [x] T059 [P] Add empty state to `src/app/candidates/[id]/pipeline/page.tsx`: when `jobs.length === 0` after loading, show message "No A/B grade matches yet — run the pipeline to discover and score jobs" with a "Run Pipeline →" button linking to the dashboard
- [x] T060 Run full Next.js test suite: `npm run test:run` — all tests pass (including new tests added in Phases 3–5)
- [x] T061 Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T062 🔵 **Invoke `superpowers:verification-before-completion`** — run `npm run test:run`, `npx tsc --noEmit`, `npm run build`; all must pass with evidence
- [ ] T063 Manual smoke test: start daemon + `npm run dev`; navigate to Pipeline page; approve a job; verify resume generation queued; snooze a job; verify it disappears; run SSE test by inserting a DB row manually
- [ ] T064 Final commit: `git add -A && git commit -m "feat: HITL review dashboard — F4 complete"`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup — DB schema, migrations)
    └─► Phase 2 (Foundational — API client, sidebar nav, snooze daemon hook)
              └─► Phase 3 (US1 — Review + Decision UI) 🎯 MVP
                        └─► Phase 4 (US2 — Checkpoint persistence + snooze resurface)
                        └─► Phase 5 (US3 — Real-time SSE notifications)
                                  └─► Phase 6 (Polish)
```

### User Story Dependencies

- **US1 (P1)**: Requires Phases 1–2 complete. Self-contained: job list API + three decision routes + `JobReviewCard` + Pipeline page. Delivers full approve/reject/snooze without real-time or crash recovery.
- **US2 (P2)**: Requires US1 Pipeline page complete (to verify checkpoint visibility). Python daemon snooze loop is independent — can be done in parallel with US1 client work.
- **US3 (P3)**: Requires US1 Pipeline page complete (to wire `startJobStream`). SSE endpoint is independent — can be built in parallel with US1 decision routes.

### Within Each Phase

- DB migration (T005–T006) MUST complete before any API route that reads/writes `hitl_checkpoints`
- API routes before UI components that call them
- Test writing MUST complete and tests MUST **FAIL** before implementation begins (TDD gates)
- TypeScript check after each phase before moving to next

### Parallel Opportunities

Within Phase 3:
- T014 (job list tests) + T018–T020 (decision route tests) + T026 (card tests) — all parallel (different files)
- T028 (`StrengthRiskChips`) + T029 (`ScoreReportPane`) + T032 (`PipelineFilterBar`) + T033 (`PipelineSortControl`) — all parallel
- After route implementations complete: T030 (`JobReviewCard`) — depends on T028, T029

Within Phase 4:
- T037–T040 (Python DB tests) can run fully in parallel with T045–T046 (Next.js checkpoint tests)

Within Phase 5:
- T048–T051 (SSE endpoint) parallel with reading US1 page code for integration (T052–T053 depend on T034)

Polish: T056, T057, T058, T059 all parallel (different files).

---

## Parallel Example: Phase 3 (US1)

```bash
# Parallel batch 1 — write failing tests simultaneously:
Task T014: src/__tests__/api/hitl/jobs.test.ts
Task T018: src/__tests__/api/hitl/approve.test.ts
Task T019: src/__tests__/api/hitl/reject.test.ts
Task T020: src/__tests__/api/hitl/snooze.test.ts
Task T026: src/__tests__/components/pipeline/JobReviewCard.test.tsx

# Parallel batch 2 — after tests confirmed failing, implement simultaneously:
Task T016: src/app/api/candidates/[id]/jobs/route.ts
Task T022: src/app/api/jobs/[jobId]/approve/route.ts
Task T023: src/app/api/jobs/[jobId]/reject/route.ts
Task T028: src/components/pipeline/StrengthRiskChips.tsx
Task T029: src/components/pipeline/ScoreReportPane.tsx
Task T032: src/components/pipeline/PipelineFilterBar.tsx
Task T033: src/components/pipeline/PipelineSortControl.tsx

# Sequential after batch 2:
Task T024: src/app/api/jobs/[jobId]/snooze/route.ts
Task T030: src/components/pipeline/JobReviewCard.tsx   ← depends on T028, T029
Task T034: src/app/candidates/[id]/pipeline/page.tsx  ← depends on all components
```

---

## Implementation Strategy

### MVP First (US1 Only — ~3 days)

1. Complete Phase 1 (Schema + migrations — ~2 hours)
2. Complete Phase 2 (API client + sidebar — ~1 hour)
3. Complete Phase 3 (US1 — job list, decisions, UI, page — ~2 days)
4. **STOP and VALIDATE**: Navigate to Pipeline page, approve a job, verify resume queued
5. MVP delivered: fully functional HITL review with approve/reject/snooze

### Incremental Delivery

1. Phases 1–3 → US1 MVP: working review dashboard
2. Phase 4 → US2: crash recovery verified + snooze resurface running
3. Phase 5 → US3: real-time new job notifications
4. Phase 6 → Production-hardened, fully verified

### Parallel Team Strategy

Once Phase 2 is complete:
- **Developer A**: US1 API routes (approve/reject/snooze/job-list) + Python daemon snooze loop
- **Developer B**: US1 React components (JobReviewCard, StrengthRiskChips, ScoreReportPane, FilterBar, SortControl)
- **Developer C**: US3 SSE endpoint — fully independent from US1 component work

---

## Task Tracker Summary

| Phase | Tasks | Completed | Status |
|---|---|---|---|
| Phase 1: Setup | T001–T009 | 9/9 | ✅ Done |
| Phase 2: Foundational | T010–T013, T065–T068 | 8/8 | ✅ Done |
| Phase 3: US1 (Review + Decisions) | T014–T036, T069 | 24/24 | ✅ Done |
| Phase 4: US2 (Checkpoint Recovery) | T037–T047 | 11/11 | ✅ Done |
| Phase 5: US3 (Real-Time SSE) | T048–T055, T070–T071 | 10/10 | ✅ Done |
| Phase 6: Polish | T056–T064 | 7/9 | 🔄 In Progress |
| **Total** | **T001–T071** | **69/71** | **97% complete** |

---

## Superpowers Skill Gate Summary

| Gate | When | Task ref |
|---|---|---|
| `superpowers:test-driven-development` | Before T015 (job list API tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T022 (decision route tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T027 (JobReviewCard tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T038 (Python DB hitl tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T050 (SSE endpoint tests) | Phase 5 |
| `superpowers:systematic-debugging` | On any test failure or unexpected behaviour | Any phase |
| `superpowers:dispatching-parallel-agents` | T014+T018+T019+T020+T026 in parallel; T028+T029+T032+T033 in parallel | Phase 3 |
| `superpowers:verification-before-completion` | Before T063 (smoke test + final commit) | Phase 6 |
