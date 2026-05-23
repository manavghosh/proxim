# Research: Pipeline Analytics Dashboard (F7) — Phase 0

**Branch**: `proxim-mvp` | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)

---

## Decision 1: Chart Library for Grade Distribution

**Decision**: Use shadcn/ui's built-in `chart` component (Recharts wrapper) for the grade distribution bar chart. Add via `npx shadcn@latest add chart`.

**Rationale**: shadcn/ui's `chart` component is the only charting option permitted by the constitution (which bans third-party UI libraries, but explicitly endorses shadcn/ui CLI-installed components). Recharts is already included as a transitive dependency. The BarChart primitive covers the A/B/C/D/F count visualisation with minimal configuration. Themed via CSS variables — consistent with the existing dark palette in `globals.css`.

**Alternatives considered**:
- **d3.js / Victory / nivo** — rejected: third-party UI libraries, violate Constitution §VI.
- **Custom SVG bars** — viable fallback if shadcn/ui chart is unavailable, but adds maintenance burden for tooltips, axes, and responsive sizing.
- **Tremor** — rejected: same third-party library constraint.

---

## Decision 2: Analytics Aggregation Strategy

**Decision**: Hybrid — denormalized aggregate columns on `pipeline_runs` (populated by Python agent at run completion) + query-time aggregation for in-progress runs and cross-run metric computations (email/LinkedIn/interview rates).

**Rationale**: The spec explicitly requires `pipeline_runs` to be extended with `ab_grade_count`, `resumes_generated`, `emails_sent`, `replies_received`. Storing these at completion prevents expensive join queries on every metrics page load (SC-002: ≤3s for 12 months of history). In-progress runs are excluded from aggregate metrics until they complete (spec edge case). Cross-run rate metrics (email open rate, LinkedIn acceptance rate) are computed at query time from `email_drafts` and `outreach_targets` because they span multiple records and change after runs complete (emails are tracked post-send).

**Alternatives considered**:
- **Fully query-time aggregation** — simpler schema, but a 12-month join across `jobs`, `email_drafts`, `outreach_targets`, `resume_versions` would breach SC-002 without DB-level indexes on every combination.
- **Materialised view** — correct approach at scale, but Neon does not auto-refresh materialized views; Python agent run-completion hook is more reliable for an MVP.

---

## Decision 3: Interview Callback Tracking

**Decision**: Add `interviewCallbackAt` timestamp column to `jobs` table. Candidate clicks "Mark as Interview" on a job card → `POST /api/jobs/[jobId]/interview` sets this timestamp. Interview callback rate = `COUNT(interviewCallbackAt IS NOT NULL) / COUNT(approved)` for the selected period.

**Rationale**: The spec states interview detection is self-reported. A single timestamp column on `jobs` is the minimal, auditable record. It avoids a new table and a new status value. The field is nullable — null means no callback reported. The action is idempotent (re-clicking does not change the timestamp, unless a "unmark" is needed — out of scope for MVP).

**Alternatives considered**:
- **New `interview_callbacks` table** — overkill for a single boolean-equivalent field; the timestamp is sufficient.
- **New `job_status` enum value `interview`** — rejected: the status enum models pipeline processing state, not post-pipeline outcomes. Mixing them complicates existing filter logic on the Applications page.

---

## Decision 4: Page Structure — Tabbed Layout

**Decision**: Extend the existing Applications page (`/candidates/[id]/applications`) with a shadcn/ui `Tabs` component at the top level: **Jobs** | **Analytics** | **History**. No new routes.

**Rationale**: The existing Applications page already holds the job card view (US1). US2 (metrics) and US3 (run history) are additive. Tabs keep the URL stable and avoid splitting a single logical feature across two pages. The `Tabs` component is already used elsewhere in the project (outreach selector). Active tab defaults to "Jobs".

**Alternatives considered**:
- **Separate `/analytics` page** — rejected: fragments the UX; the spec describes this as a single dashboard.
- **Scrollable sections below job cards** — rejected: too much content for one scroll — analytics + history table become unwieldy below a large job card grid.
- **Sidebar navigation sub-items** — rejected: the sidebar already has "Applications" as a single nav entry; sub-items require layout changes out of scope.

---

## Decision 5: CSV Export Implementation

**Decision**: Native `ReadableStream` in a Next.js Route Handler (`GET /api/candidates/[id]/analytics/export`) — no CSV library. Build rows by streaming query results from `pipeline_runs`. Response header `Content-Disposition: attachment; filename="pipeline-history.csv"`.

**Rationale**: The CSV schema is fixed (one row per `pipeline_run` with ~10 columns). Native string serialisation with proper comma/quote escaping is 10 lines of code — no dependency needed. Streaming avoids loading 500 runs into memory before writing (SC-003: ≤10s for 500 runs).

**Alternatives considered**:
- **`csv-stringify` / `papaparse`** — unnecessary dependency for a fixed-schema export.
- **Client-side CSV generation** — rejected: requires fetching all data to the browser first; SC-003 target is easier to hit server-side.

---

## Decision 6: Failed Job Retry — Stage Identification

**Decision**: `POST /api/jobs/[jobId]/retry` queries `pipeline_jobs WHERE candidate_id=? ORDER BY created_at DESC LIMIT 1` for the given job's latest pipeline_job entry (searching by matching the job's id in payload or via a new `job_id` FK). Re-inserts a new `pipeline_jobs` row with the same `job_type`. The job's status is reset to the state that precedes that stage.

**Rationale**: The spec (FR-004) says retry enqueues "starting from the failed stage". The Python daemon writes a `pipeline_jobs` row per agent (job_type = `resume_builder` | `linkedin_connector` | `outreach_mailer`). The most recently failed pipeline_job for the given job id identifies which stage failed. A new queue entry for the same `job_type` restarts that stage without re-running earlier ones.

**Implementation note**: The `pipeline_jobs.payload` already stores `job_id` (the `jobs` table PK). The retry query is: `SELECT * FROM pipeline_jobs WHERE payload->>'job_id' = $1 AND status='failed' ORDER BY created_at DESC LIMIT 1`. No schema change required.

**Alternatives considered**:
- **Full pipeline re-run from discovery** — rejected: spec explicitly says "starting from the failed stage".
- **New `retry_of` FK column on `pipeline_jobs`** — nice for auditability but out of scope for MVP.

---

## Decision 7: SSE Extension for Pipeline Stage Updates

**Decision**: Extend the existing `/api/candidates/[id]/jobs/stream` SSE endpoint (F4) to also emit `run_status_changed` events when any `pipeline_runs.status` transitions for the candidate. No new SSE endpoint needed.

**Rationale**: SC-001 requires pipeline stage updates within 5 seconds. The F4 SSE stream already polls `jobs` every 5 seconds for the candidate. Adding a secondary check on `pipeline_runs WHERE candidate_id = ?` in the same poll loop adds ~1 extra DB query per 5-second tick. Reusing the existing stream avoids duplicate SSE connection management in the Applications page component.

**Alternatives considered**:
- **New dedicated run-status SSE endpoint** — rejects: more client-side connection management, no benefit over extending the existing stream.
- **WebSocket** — rejected: Constitution §VII does not permit custom HTTP infrastructure on the agent service; Next.js App Router SSE is the established pattern.

---

## Decision 8: Time Range Filter Granularity

**Decision**: Four fixed ranges — **Last 7 days** / **Last 30 days** / **Last 90 days** / **All time**. Computed as `pipeline_runs.started_at >= now() - interval`. No custom date picker.

**Rationale**: The spec (FR-007) lists exactly these four options. A custom picker adds significant UI complexity for minimal benefit at MVP stage. The filter is applied to `pipeline_runs.started_at` (not `completed_at`) so in-progress runs appear in their correct time bucket. Stored in component state — not persisted to `candidates.preferences` (filter selection is transient, not a preference).

---

## Decision 9: Grade Distribution Chart Scope

**Decision**: Grade distribution charts over `jobs WHERE pipeline_run_id IN (runs in selected time range)`. Counts: A / B / C / D / E / F (all 6 grades shown). Uses shadcn/ui `BarChart`.

**Rationale**: Shows the full grade distribution to help the candidate calibrate scoring expectations. Including F grades in the chart (even though F-grade jobs are excluded from the review queue) is informative — a high F count may indicate mis-configured preferences.

---

## Decision 10: Drizzle Migration for Aggregate Fields

**Decision**: Single Drizzle migration adding:
- 4 integer columns to `pipeline_runs`: `abGradeCount`, `resumesGenerated`, `emailsSent`, `repliesReceived`
- 1 timestamp column to `jobs`: `interviewCallbackAt`

All new integer columns default to 0 and are not null; `interviewCallbackAt` is nullable. Backward-compatible — existing rows get default values.

**Python agent update**: `db.py` gains an `update_run_aggregates(run_id)` function called at run completion, computing each count via a single SQL query per metric.

**Alternatives considered**:
- **Separate `pipeline_run_stats` table** — correct for strict normalisation, but unnecessary for 5 scalar fields; inline columns are simpler to query.
