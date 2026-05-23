# Tasks: Pipeline Analytics Dashboard (F7)

**Input**: Design documents from `specs/007-pipeline-analytics-dashboard/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/api.md ✅ quickstart.md ✅

**Organization**: Tasks grouped by user story to enable independent implementation and testing of each story increment.

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel with other [P] tasks at the same phase level (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)
- File paths are absolute from repository root

---

## Phase 1: Setup

**Purpose**: Add the one new package required by US2 (chart component). The rest of the stack is already in place.

- [x] T001 Install shadcn/ui chart component via `npx shadcn@latest add chart` — adds `src/components/ui/chart.tsx` and installs `recharts` as a dependency

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema changes, TypeScript types, Python aggregate helper, and Application page tab scaffold. ALL must complete before any user story begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Extend `pipelineRuns` table with `abGradeCount`, `resumesGenerated`, `emailsSent`, `repliesReceived` integer columns (default 0, not null) and add `index('pipeline_runs_candidate_started_idx').on(table.candidateId, table.startedAt)` for SC-002 query performance; extend `jobs` table with `interviewCallbackAt` nullable timestamp — `src/db/schema.ts`
- [x] T003 Generate and apply Drizzle migration for the T002 schema changes; verify columns exist in DB — `migrations/` (run `npm run db:generate && npm run db:migrate`)
- [x] T004 [P] Add `AnalyticsMetrics`, `PipelineRunSummary`, `TimeRange` types to `src/types/candidate.ts`; extend the `ScoredJob` interface in `src/lib/api.ts` with `updatedAt: string`, `interviewCallbackAt: string | null`, `errorMessage: string | null`, and `pipelineJobStatus: string | null` (latest pipeline_jobs status for per-agent display) — `src/types/candidate.ts` and `src/lib/api.ts`
- [x] T005 [P] Create `analytics-service.ts` with pure functions: `computeMetrics(runs, candidateId, db)` for rate calculations (A/B grade rate, email open/reply rates, LinkedIn acceptance rate, interview callback rate — handle zero denominators with `null`) and `computeGradeDistribution(candidateId, runIds, db)` — `src/lib/analytics-service.ts`
- [x] T006 [P] Add `update_run_aggregates(conn, run_id)` async function to Python agent DB helper computing `ab_grade_count`, `resumes_generated`, `emails_sent`, `replies_received` via single SQL UPDATE; wire call into run completion path in the pipeline graph — `agent/agent/db.py` and the relevant pipeline graph completion handler
- [x] T007 Restructure Applications page to a shadcn/ui `Tabs` layout with three tab triggers (Jobs | Analytics | History) and empty placeholder `TabsContent` panels for Analytics and History; preserve all existing Jobs tab functionality unchanged — `src/app/candidates/[id]/applications/page.tsx`

**Checkpoint**: Migration applied, types defined, tab scaffold renders with existing Jobs tab working. Python agent compiles and `update_run_aggregates` is callable.

---

## Phase 3: User Story 1 — Real-Time Pipeline Status View (Priority: P1) 🎯 MVP

**Goal**: Every job card on the Applications page shows its current pipeline stage, elapsed time in that stage, last agent action, and an error card with a retry button for failed stages. New pipeline stage changes appear within 5 seconds via SSE. Candidate can mark any approved/resume_ready job as having led to an interview callback.

**Independent Test**: Seed one job per active pipeline stage. Verify each card shows elapsed time, that a `pipeline_jobs.status='failed'` job renders an error card with a retry button that successfully inserts a new `pipeline_jobs` row on click, and that marking a job as "Interview" sets `jobs.interview_callback_at` in the DB.

- [x] T008 [P] [US1] Create `POST /api/jobs/[jobId]/interview` route: accept `{ mark: boolean }`, set or clear `jobs.interviewCallbackAt`, return `{ jobId, interviewCallbackAt }` — `src/app/api/jobs/[jobId]/interview/route.ts`
- [x] T009 [P] [US1] Create `POST /api/jobs/[jobId]/retry-stage` route: find latest `pipeline_jobs` row for the job's `id` in `payload->>'job_id'` with `status='failed'`; insert new `pipeline_jobs` row with same `job_type`; reset `jobs.status` to the appropriate pre-stage value; return 409 if a `running` pipeline_job already exists; return 404 if no failed job found — `src/app/api/jobs/[jobId]/retry-stage/route.ts`
- [x] T010 [P] [US1] Extend `GET /api/jobs` (the Applications page route, NOT the Pipeline review-queue route) to select and return `jobs.updatedAt`, `jobs.interviewCallbackAt`, `jobs.errorMessage`, and `pipelineJobStatus` (latest `pipeline_jobs.status` for this job via a LEFT JOIN on `pipeline_jobs` filtered to the most-recent row per job using a `DISTINCT ON (job_id)` or sub-query ordered by `created_at DESC`); add all four fields to the mapped response object — `src/app/api/jobs/route.ts`
- [x] T011 [P] [US1] Extend `GET /api/candidates/[id]/jobs/stream` SSE: on the same 5-second tick as the existing job-arrival poll, also query `pipeline_runs WHERE candidate_id = ?`; maintain a `Map<runId, lastKnownStatus>` in the handler closure; emit `run_status_changed` event `{ runId, status, candidateId }` only on the first tick a run transitions from `running` to `completed` or `failed` (de-duplicated — never re-emit for the same terminal status) — `src/app/api/candidates/[id]/jobs/stream/route.ts`
- [x] T012 [US1] Add `markInterview(jobId: string, candidateId: string, mark: boolean)` (calls `POST /api/jobs/[jobId]/interview`) and `retryPipelineStage(jobId: string, candidateId: string)` (calls `POST /api/jobs/[jobId]/retry-stage`) functions to the API client; also extend `startJobStream` to accept an optional `onRunStatusChanged?: (runId: string, status: string) => void` fourth parameter and register `eventSource.addEventListener('run_status_changed', ...)` internally — `src/lib/api.ts`
- [x] T013 [P] [US1] Enhance `JobCard` component: (a) compute and display elapsed time in stage from `job.updatedAt` (e.g. "3h 22m in resume_ready") as a muted chip — this also satisfies FR-001's "last agent action" requirement; (b) add per-agent status badge using this explicit mapping: `pipelineJobStatus='running'` → "Running"; `pipelineJobStatus='queued'` and `job.status='approved'` → "Queued"; `job.status in ['resume_failed']` OR `job.errorMessage` non-null → "Error"; `job.status in ['resume_ready','submitted']` → "Done" — derive the display agent name from `pipelineJobStatus` context (e.g. "Resume Builder", "LinkedIn Connector", "Outreach Mailer"); (c) render an error card when `job.errorMessage` is non-null, showing agent name, failure description, failure timestamp (`job.updatedAt` displayed as a relative time e.g. "Failed 2h ago"), and a "Retry" button that calls `onRetry`; (d) add "Mark as Interview" / "Unmark" toggle button for jobs with `status` in `['approved','resume_ready','submitted']` — `src/components/applications/JobCard.tsx`
- [x] T014 [US1] Wire Jobs tab in Applications page: add `onRetry` and `onMarkInterview` handlers calling `retryPipelineStage` and `markInterview`; pass `onRunStatusChanged` callback to `startJobStream` to trigger silent refresh when a run completes; update `ScoredJob` state optimistically on interview mark/unmark — `src/app/candidates/[id]/applications/page.tsx`

**Checkpoint**: Jobs tab fully functional with enhanced cards. Retry button works. Interview marking persists. SSE pushes updates within 5 seconds of a pipeline stage change.

---

## Phase 4: User Story 2 — Campaign Performance Metrics (Priority: P2)

**Goal**: Analytics tab shows six metric cards (jobs discovered, A/B grade rate %, email open rate %, email reply rate %, LinkedIn acceptance rate %, interview callback rate %), a grade distribution bar chart (A–F), and a time range filter (7d / 30d / 90d / All Time). All metrics update when the filter changes. In-progress runs are excluded from rates and flagged with a notice.

**Independent Test**: Seed fixture `pipeline_runs` with known aggregate values. Verify each metric card shows the correct computed value. Change the time range filter and verify all six cards update to reflect only runs within the selected period. Verify `inProgressRuns > 0` triggers the "excluded from metrics" notice.

- [x] T015 [P] [US2] Create `GET /api/candidates/[id]/analytics` route: accept `?range=7d|30d|90d|all` (default `30d`); query completed `pipeline_runs` in range; call `computeMetrics` and `computeGradeDistribution` from `analytics-service`; return `{ metrics: AnalyticsMetrics, range }` — `src/app/api/candidates/[id]/analytics/route.ts`
- [x] T016 [P] [US2] Create `MetricCard` component: props `{ label: string; value: number | null; unit?: '%' | '' }` — render `null` as `—` (em dash); use shadcn/ui `Card` with large value display and muted label — `src/components/applications/MetricCard.tsx`
- [x] T017 [P] [US2] Create `GradeDistributionChart` component: props `{ distribution: AnalyticsMetrics['gradeDistribution'] }` — render shadcn/ui `BarChart` (from `src/components/ui/chart.tsx`) with one bar per grade (A–F), coloured by grade tier (A/B green, C/D amber, E/F red), height proportional to count, tooltip showing count — `src/components/applications/GradeDistributionChart.tsx`
- [x] T018 [US2] Add `getAnalytics(candidateId: string, range: TimeRange)` returning `AnalyticsMetrics` to the API client — `src/lib/api.ts`
- [x] T019 [US2] Create `AnalyticsPanel` component: renders 6 `MetricCard` tiles in a responsive 2-col or 3-col grid, `GradeDistributionChart` below, time range filter using shadcn/ui `Select` (7d / 30d / 90d / All Time), and an info `Badge` ("1 run in progress — excluded from metrics") when `metrics.inProgressRuns > 0`; loading skeleton using `Skeleton` while fetch is in-flight — `src/components/applications/AnalyticsPanel.tsx`
- [x] T020 [US2] Wire Analytics tab in Applications page: mount `AnalyticsPanel` inside the Analytics `TabsContent`; manage `analyticsRange` state (`TimeRange`, default `'30d'`); re-fetch analytics when range changes or when `run_status_changed` SSE fires while Analytics tab is active — `src/app/candidates/[id]/applications/page.tsx`

**Checkpoint**: Analytics tab renders with correct metric values. Time range filter updates all six cards. In-progress run indicator appears when applicable. Chart renders for all six grade buckets.

---

## Phase 5: User Story 3 — Run History and Export (Priority: P3)

**Goal**: History tab shows a paginated table of completed/failed pipeline runs (50 per page) with start time, duration, jobs discovered, A/B graded, resumes generated, emails sent, replies. A CSV export button downloads all runs for the selected time range. In-progress runs appear separately at the top with a "running" indicator.

**Independent Test**: Seed 55 completed `pipeline_runs`. Verify page 1 shows 50 rows sorted by `startedAt` DESC, page 2 shows 5 rows, total count = 55. Click Export and verify CSV has 55 data rows plus a header row. Apply a 7-day filter and verify both table and CSV shrink to only runs in that window.

- [x] T021 [P] [US3] Create `GET /api/candidates/[id]/analytics/runs` route: accept `?page=1&range=all`; query `pipeline_runs WHERE status IN ('completed','failed')` with time range filter; order by `startedAt DESC`; return `{ runs: PipelineRunSummary[], total, page, totalPages }` with `LIMIT 50 OFFSET (page-1)*50`; also return in-progress runs separately in `{ inProgress: PipelineRunSummary[] }` — `src/app/api/candidates/[id]/analytics/runs/route.ts`
- [x] T022 [P] [US3] Create `GET /api/candidates/[id]/analytics/export` route: accept `?range=all`; stream CSV response with `Content-Disposition: attachment; filename="pipeline-history.csv"`; write header row then one data row per completed/failed `pipeline_run` in range; escape commas and quotes in string fields — `src/app/api/candidates/[id]/analytics/export/route.ts`
- [x] T023 [US3] Add `getRunHistory(candidateId, page, range)` and `exportRunHistory(candidateId, range)` to the API client; `exportRunHistory` triggers a browser download by creating a temporary anchor element — `src/lib/api.ts`
- [x] T024 [P] [US3] Create `RunHistoryTable` component: renders in-progress runs at top with an animated pulse indicator; below them a table (shadcn/ui `Table`) with columns: Start Time, Duration, Discovered, A/B Grade, Resumes, Emails Sent, Replies; pagination using shadcn/ui `Button` prev/next; "Export to CSV" button at top right that calls `onExport`; loading skeleton on page change — `src/components/applications/RunHistoryTable.tsx`
- [x] T025 [US3] Wire History tab in Applications page: mount `RunHistoryTable` inside History `TabsContent`; manage `historyPage` state (default 1); share `analyticsRange` state from US2 tab so the History table and Export respect the same time range selection — `src/app/candidates/[id]/applications/page.tsx`

**Checkpoint**: History tab shows paginated run list. Pagination navigates correctly. Export downloads a valid CSV. In-progress runs appear at top of table. Time range filter shared with Analytics tab updates the history list and export.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Service-layer tests for edge cases, type checking, build verification.

- [x] T026 [P] Write unit tests for `analytics-service.ts` covering: zero-denominator rate returns `null`, empty runs array returns zeroed metrics, `inProgressRuns` count is correct, grade distribution sums match total job count — `src/__tests__/lib/analytics-service.test.ts`
- [x] T027 [P] Run full TypeScript check (`npx tsc --noEmit`) — zero errors required; run production build (`npm run build`) — zero prerender errors required
- [x] T028 Run quickstart validation: apply migration, verify all three tabs render, verify Retry button inserts new pipeline_jobs row, verify CSV export downloads in < 10 seconds, verify SSE emits run_status_changed on run completion

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user stories**
- **Phase 3 (US1)**: Depends on Phase 2 completion
- **Phase 4 (US2)**: Depends on Phase 2 completion; T019 depends on T016 + T017; T020 depends on T018 + T019
- **Phase 5 (US3)**: Depends on Phase 2 completion; T023 depends on T021 + T022; T025 depends on T023 + T024
- **Phase 6 (Polish)**: Depends on all desired story phases being complete

### Within-Phase Dependencies

**Phase 2**:
- T002 → T003 (must generate schema before migrating)
- T004, T005, T006 can run in parallel with each other (after T002 completes for schema reference)
- T007 depends on T004 (needs ScoredJob type update)

**Phase 3 (US1)**:
- T008, T009, T010, T011 can run in parallel (different files)
- T012 depends on T010 (needs confirmed response field names)
- T013 can run in parallel with T012 (different files; prop types come from T004)
- T014 depends on T012 + T013

**Phase 4 (US2)**:
- T015, T016, T017 can run in parallel (different files)
- T018 depends on T015 (needs confirmed response shape)
- T019 depends on T016 + T017
- T020 depends on T018 + T019

**Phase 5 (US3)**:
- T021, T022 can run in parallel
- T023 depends on T021 + T022
- T024 can run in parallel with T021 + T022
- T025 depends on T023 + T024

---

## Parallel Execution Examples

### Phase 2 — After T002 + T003 complete

```
T004 (types/candidate.ts)         ← parallel
T005 (analytics-service.ts)       ← parallel
T006 (agent/db.py)                ← parallel
```

### Phase 3 — US1 (all independent files)

```
T008 (interview/route.ts)         ← parallel
T009 (retry-stage/route.ts)       ← parallel
T010 (api/jobs/route.ts)          ← parallel  ← Applications page route, NOT pipeline review queue
T011 (stream/route.ts)            ← parallel

T012 (api.ts) + T013 (JobCard)    ← parallel with each other, after T010
```

### Phase 4 — US2

```
T015 (analytics/route.ts)         ← parallel
T016 (MetricCard.tsx)             ← parallel
T017 (GradeDistributionChart.tsx) ← parallel
```

### Phase 5 — US3

```
T021 (analytics/runs/route.ts)    ← parallel
T022 (analytics/export/route.ts)  ← parallel
T024 (RunHistoryTable.tsx)        ← parallel with T021 + T022
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001)
2. Complete Phase 2 (T002–T007)
3. Complete Phase 3 / US1 (T008–T014)
4. **STOP and VALIDATE**: Jobs tab shows elapsed time, error cards, retry button, interview marking, SSE updates
5. Ship US1 — delivers core pipeline visibility (FR-001 through FR-005)

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready
2. Phase 3 (US1) → Real-time pipeline status → **Demo/ship**
3. Phase 4 (US2) → Campaign metrics + grade chart → **Demo/ship**
4. Phase 5 (US3) → Run history + CSV export → **Demo/ship**
5. Phase 6 → Tests + verification

Each phase ships independently without breaking earlier phases.

---

## Notes

- `src/app/candidates/[id]/applications/page.tsx` is modified in T007, T014, T020, and T025 — tasks must run **sequentially in phase order**; each task extends what the previous one added
- `src/lib/api.ts` is modified in T012, T018, and T023 — same sequential constraint
- The `analytics-service.ts` (T005) is pure TypeScript functions with no Next.js dependencies — testable with Vitest + no DOM
- The Python `update_run_aggregates` (T006) is only called at pipeline completion — existing in-flight pipelines are unaffected until they complete
- All 6 grades (A/B/C/D/E/F) ARE included in the grade distribution chart (T017) — spec FR-008 lists A/B/C/D/F but omits E; the codebase has E as a valid grade and research.md Decision 9 confirms all 6 shown; spec.md updated accordingly
- Time range state is shared between Analytics tab and History tab (both use `analyticsRange`) — wired in T020 and T025 within the same page component
