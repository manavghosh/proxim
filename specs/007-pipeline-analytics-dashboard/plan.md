# Implementation Plan: Pipeline Analytics Dashboard (F7)

**Branch**: `proxim-mvp` | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/007-pipeline-analytics-dashboard/spec.md`

## Summary

F7 extends the existing Applications page (`/candidates/[id]/applications`) with three capabilities: (1) enhanced real-time pipeline status per job card (elapsed time in stage, per-agent status, error cards with retry), (2) an Analytics tab showing six aggregate campaign metrics, a grade distribution bar chart, and a time range filter, and (3) a History tab with paginated run history and CSV export. The implementation requires a single Drizzle migration (4 columns on `pipeline_runs`, 1 on `jobs`), five new API routes, and enhancements to the existing SSE stream, job route, and Applications page component. No new packages are required beyond `shadcn/ui chart` (Recharts wrapper, added via CLI).

## Technical Context

**Language/Version**: TypeScript 5 + Node.js 22 (Next.js 15), Python 3.11+ (agent daemon)
**Primary Dependencies**: Next.js 15 App Router, Drizzle ORM, Tailwind CSS v4, shadcn/ui (chart component added), Lucide React, Vitest + @testing-library/react
**Storage**: Neon PostgreSQL (prod) / SQLite (dev) — `pipeline_runs` extended with 4 aggregate integer columns; `jobs` extended with `interviewCallbackAt` timestamp
**Testing**: Vitest + @testing-library/react (Next.js), pytest (Python agent aggregate update function)
**Target Platform**: Next.js 15 App Router (UI + API routes) + Python polling daemon (aggregate field population at run completion)
**Project Type**: Dual-runtime web application (Next.js + Python daemon)
**Performance Goals**: Metrics load ≤3s for 12 months of history (SC-002); CSV export ≤10s for 500 runs (SC-003); pipeline stage updates ≤5s via SSE (SC-001)
**Constraints**: In-progress runs excluded from aggregate metric calculations (FR-012); run history paginated at 50 rows (FR-010); interview callback tracking is self-reported only
**Scale/Scope**: Single candidate per session, up to 500 pipeline runs for CSV export, up to 12 months of history for analytics

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. HITL-First | ✅ PASS | F7 is a read-only analytics dashboard. The one new write action (retry) re-queues a pipeline job that was already approved by the candidate — it does not initiate new outreach. Interview callback marking is informational only. No new outbound actions introduced. |
| II. Agent Modularity | ✅ PASS | The Python agent's new `update_run_aggregates()` call is a single DB write at run completion — a side-effect within the existing completion handler, not a new agent. No cross-agent state dependency introduced. |
| III. Factual Integrity | ✅ PASS | No LLM calls in this feature. All displayed data (grades, email counts, run stats) is read verbatim from DB fields written by upstream agents. |
| IV. Observability | ✅ PASS | All new route handlers follow the existing error logging pattern. The SSE extension logs `run_status_changed` events. No new LLM calls to instrument. |
| V. Provider-Agnostic LLM | ✅ PASS | No LLM calls in this feature scope. |
| VI. Technology Standards | ✅ PASS | Next.js 15, Drizzle migration for schema changes, shadcn/ui `chart` component (Recharts), Tailwind v4. `shadcn/ui chart` is added via `npx shadcn@latest add chart` — permitted by constitution. No other new packages. |
| VII. Dual-Runtime | ✅ PASS | Next.js handles all UI + analytics API routes. Python daemon adds one `update_run_aggregates()` call at run completion. All communication through Neon — no HTTP between runtimes. |

*Post-Phase-1 re-check: All gates remain green. Hybrid aggregation strategy (denormalised columns + query-time computation) is simpler than a separate stats table and avoids materialised view complexity. Interview tracking via single nullable column is minimal and non-invasive.*

## Project Structure

### Documentation (this feature)

```text
specs/007-pipeline-analytics-dashboard/
├── spec.md              ← Feature specification
├── plan.md              ← This file
├── research.md          ← Phase 0: chart library, aggregation, page structure, CSV, retry
├── data-model.md        ← Phase 1: pipeline_runs extensions, jobs extension, metric types
├── quickstart.md        ← Phase 1: setup, testing, SSE verification
├── contracts/
│   └── api.md           ← Phase 1: analytics, runs, export, interview, retry endpoints
└── tasks.md             ← Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (additions and modifications for this feature)

```text
src/
├── app/
│   ├── candidates/[id]/applications/
│   │   └── page.tsx                              ← MODIFY: add Tabs (Jobs | Analytics | History)
│   └── api/
│       ├── candidates/[id]/
│       │   ├── analytics/
│       │   │   ├── route.ts                      ← NEW: GET aggregate metrics
│       │   │   ├── runs/
│       │   │   │   └── route.ts                  ← NEW: GET paginated run history
│       │   │   └── export/
│       │   │       └── route.ts                  ← NEW: GET CSV download (streamed)
│       │   └── jobs/
│       │       ├── route.ts                      ← MODIFY: add updatedAt + interviewCallbackAt fields
│       │       └── stream/route.ts               ← MODIFY: emit run_status_changed events
│       └── jobs/[jobId]/
│           ├── interview/
│           │   └── route.ts                      ← NEW: POST mark/unmark interview callback
│           └── retry/
│               └── route.ts                      ← NEW: POST re-enqueue failed pipeline stage
├── components/
│   └── applications/
│       ├── AnalyticsPanel.tsx                    ← NEW: 6 metric cards + grade chart + time filter
│       ├── RunHistoryTable.tsx                   ← NEW: paginated table + export button
│       ├── GradeDistributionChart.tsx            ← NEW: shadcn/ui BarChart (A–F counts)
│       ├── MetricCard.tsx                        ← NEW: reusable metric tile (value + label)
│       └── JobCard.tsx                           ← MODIFY: add elapsed time, agent status chip,
│                                                            error card, retry button,
│                                                            interview callback button
├── lib/
│   ├── api.ts                                    ← MODIFY: add getAnalytics, getRunHistory,
│   │                                                        exportRunHistory, markInterview,
│   │                                                        retryPipelineStage
│   └── analytics-service.ts                      ← NEW: pure metric computation functions (testable)
├── types/
│   └── candidate.ts                             ← MODIFY: add AnalyticsMetrics, PipelineRunSummary,
│                                                           TimeRange types; add interviewCallbackAt
│                                                           and updatedAt to ScoredJob
└── db/
    └── schema.ts                                ← MODIFY: add 4 columns to pipelineRuns;
                                                           add interviewCallbackAt to jobs

migrations/
└── 0012_pipeline_analytics_fields.sql           ← Generated by drizzle-kit (ALTER TABLE only)

agent/
└── agent/
    └── db.py                                    ← MODIFY: add update_run_aggregates()
                                                           called from run completion handler

src/__tests__/
├── lib/
│   └── analytics-service.test.ts                ← NEW: metric computation edge cases
└── api/
    └── analytics.test.ts                        ← NEW: route response shape + empty state
```

**Structure Decision**: Single-project Next.js application with Python agent sidecar. All analytics queries live in new Route Handlers. Business logic (metric computation, rate calculations) is extracted into `src/lib/analytics-service.ts` for testability, following the `*-service.ts` pattern established for `cv-service`, `preferences-service`, and `readiness-service`.

## Complexity Tracking

No constitution violations. The shadcn/ui `chart` component (Recharts wrapper) is the only new package — installed via CLI as required by the constitution, not hand-copied.

The hybrid aggregation approach (denormalised integer columns on `pipeline_runs` + query-time rate calculations) is a deliberate trade-off: simpler than a materialised view, meets the 3-second load target for 12 months of history, and stays within the existing Drizzle migration pattern. The denormalized columns are populated once at run completion by the Python agent — no read-path complexity added to Next.js.
