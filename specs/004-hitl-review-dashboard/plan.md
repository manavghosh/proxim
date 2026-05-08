# Implementation Plan: HITL Review Dashboard (F4)

**Branch**: `004-hitl-review-dashboard` | **Date**: 2026-05-04 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/004-hitl-review-dashboard/spec.md`

## Summary

The HITL Review Dashboard replaces the `/candidates/[id]/pipeline` placeholder page with a fully functional job review interface. Scored jobs (`grade` A–D, never F) appear as cards with colour-coded grade badges, numeric scores, strength/risk chips, and inline expandable 6-block score reports. The candidate approves, rejects, or snoozes each job; Approve atomically enqueues a resume generation entry in `pipeline_jobs`. A `hitl_checkpoints` table records every decision, providing auditability and crash recovery — `awaiting` jobs persist across service restarts. New scored jobs stream to the open dashboard within 5 seconds via a candidate-scoped SSE endpoint. A Python daemon job resurfaces snoozed jobs after 7 days automatically.

## Technical Context

**Language/Version**: TypeScript 5 + Node.js 22 (Next.js), Python 3.14 (agent daemon)
**Primary Dependencies**: Next.js 15 App Router, Drizzle ORM, Tailwind CSS v4, shadcn/ui, Lucide React, Vitest + @testing-library/react
**Storage**: Neon PostgreSQL (prod) / SQLite (dev) — new `hitl_checkpoints` table; existing `jobs` table extended with `snoozed_until` timestamp
**Testing**: Vitest + @testing-library/react (Next.js), pytest + pytest-asyncio (Python snooze daemon)
**Target Platform**: Next.js 15 App Router (UI + API routes) + Python polling daemon (snooze resurface)
**Project Type**: Dual-runtime web application (Next.js + Python daemon)
**Performance Goals**: Grade badge renders ≤200ms (SC-003); new jobs appear ≤5s via SSE (SC-004); approve/reject/snooze action round-trip ≤60s per job (SC-001)
**Constraints**: F-grade jobs NEVER on dashboard (FR-004); concurrent approvals race-safe via DB row update with status precondition check (FR-012); SSE auto-reconnect on disconnect (FR-014)
**Scale/Scope**: Single candidate per session, ~50–500 scored jobs per pipeline run; multi-candidate admin view already supported via URL-based routing

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. HITL-First | ✅ PASS | This feature IS the HITL gate. Approve/Reject/Snooze are explicit user actions. No outbound action fires without a confirmed user decision on this dashboard. |
| II. Agent Modularity | ✅ PASS | Snooze resurface is a standalone daemon job with no internal state coupling. HITL dashboard reads from DB only — no agent internal state exposed. |
| III. Factual Integrity | ✅ PASS | No LLM calls in this feature. All displayed data (grade, score, report) is read verbatim from the `jobs` table populated by F9. |
| IV. Observability | ✅ PASS | All HITL decisions written to `hitl_checkpoints` with timestamps. SSE events structured as JSON. LangSmith tracing not required (no LLM calls). |
| V. Provider-Agnostic LLM | ✅ PASS | No LLM calls in this feature scope. |
| VI. Technology Standards | ✅ PASS | Next.js 15, Drizzle migration for `hitl_checkpoints`, shadcn/ui components, Tailwind v4. No new packages required beyond existing stack. |
| VII. Dual-Runtime | ✅ PASS | Next.js handles all UI + decision API routes. Python daemon handles only the snooze resurface scheduler. All communication through DB — no HTTP between runtimes. |

*Post-Phase-1 re-check: All gates remain green. `hitl_checkpoints` table replaces LangGraph built-in checkpointer for simplicity and auditability. Decision confirmed in research.md.*

## Project Structure

### Documentation (this feature)

```text
specs/004-hitl-review-dashboard/
├── spec.md              ← Feature specification
├── plan.md              ← This file
├── research.md          ← Phase 0: checkpoint strategy, SSE pattern, snooze design
├── data-model.md        ← Phase 1: hitl_checkpoints schema, state transitions, SSE events
├── quickstart.md        ← Phase 1: How to test HITL decisions and SSE
├── contracts/
│   └── api.md           ← Phase 1: API routes for review actions + SSE endpoint
└── tasks.md             ← Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (additions for this feature)

```text
src/
├── app/
│   ├── candidates/[id]/
│   │   └── pipeline/
│   │       └── page.tsx                         ← REPLACE placeholder with HITL dashboard
│   └── api/
│       ├── candidates/[id]/
│       │   └── jobs/
│       │       ├── route.ts                     ← GET scored+awaiting jobs for candidate
│       │       └── stream/route.ts              ← SSE: new job arrival stream (5s poll)
│       └── jobs/[jobId]/
│           ├── approve/route.ts                 ← POST approve → queues resume + checkpoint
│           ├── reject/route.ts                  ← POST reject → updates status + checkpoint
│           └── snooze/route.ts                  ← POST snooze 7d → sets snoozed_until + checkpoint
├── components/
│   └── pipeline/
│       ├── JobReviewCard.tsx                    ← Card: grade badge, score, chips, actions
│       ├── ScoreReportPane.tsx                  ← Inline markdown report (collapsible)
│       ├── StrengthRiskChips.tsx                ← Top-3 strengths + top-2 risks chips
│       ├── PipelineFilterBar.tsx                ← Grade filter: A / A+B / All (C/D)
│       └── PipelineSortControl.tsx              ← Sort: score / posted date / company
├── lib/
│   └── api.ts                                   ← MODIFY: add getCandidateJobs, approveJob,
│                                                           rejectJob, snoozeJob, startJobStream
└── db/
    └── schema.ts                                ← MODIFY: add hitlCheckpoints table;
                                                            add snoozedUntil to jobs table

agent/
└── agent/
    ├── db_sqlite.py                             ← MODIFY: add get_snoozed_jobs_to_resurface,
    │                                                       mark_job_unsnoozed
    └── daemon.py                               ← MODIFY: add snooze_resurface polling loop

migrations/                                     ← Generated by drizzle-kit generate
migrations/sqlite/                              ← Generated by db:generate:sqlite
```

**Structure Decision**: Dual-runtime. Next.js owns all UI + HITL decision API routes (approve/reject/snooze). Python daemon owns only the snooze resurface scheduler — a simple DB poll every 60 seconds checking `snoozed_until <= now()`. All communication via DB. The `/candidates/[id]/pipeline` page replaces the existing placeholder.

## Complexity Tracking

No constitution violations. The `hitl_checkpoints` table is preferred over LangGraph's built-in checkpointer because: (a) no graph resumption is needed — decisions update job status, and downstream agents pick up from DB state; (b) it avoids the overhead of persisting full graph state at every node; (c) it provides full auditability of every HITL decision with timestamps. This is simpler and more appropriate for this architecture.
