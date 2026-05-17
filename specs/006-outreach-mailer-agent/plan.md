# Implementation Plan: Outreach Mailer Agent (F6)

**Branch**: `006-outreach-mailer-agent` | **Date**: 2026-05-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/006-outreach-mailer-agent/spec.md`

## Summary

The Outreach Mailer Agent (F6) runs automatically after a job is approved. It discovers the hiring manager's email via Hunter.io (Email Finder first, Domain Search fallback), generates a personalised three-email cadence (Day 1 intro ≤150w, Day 3 value-add ≤100w, Day 7 gentle close ≤80w) using LiteLLM with Pydantic validation and a "would a human send this?" self-review check, then surfaces all three drafts on the dashboard for HITL candidate approval. After approval, Day 1 fires via Gmail API with resume + cover letter PDFs attached; Day 3 and Day 7 fire automatically via a Python daemon polling loop (every 3 minutes, checking 72h/168h elapsed since Day 1 with no reply detected). Replies pause the cadence immediately; Day 1 bounces permanently cancel Day 3 and Day 7. Open/click tracking uses a custom Next.js redirect endpoint embedded in email HTML.

## Technical Context

**Language/Version**: TypeScript 5 + Node.js 22 (Next.js), Python 3.11+ (LangGraph agent daemon)
**Primary Dependencies**: Next.js 15 App Router, Drizzle ORM, Tailwind CSS v4, shadcn/ui, Lucide React, Vitest + @testing-library/react (Next.js); LangGraph 0.4+, LiteLLM 1.40+, asyncpg/aiosqlite, Pydantic v2, `google-api-python-client`, `google-auth` (Python agent)
**Storage**: Neon PostgreSQL (prod) / SQLite (dev) — new `email_cadences` and `email_drafts` tables; `outreach_targets` extended with `email`, `email_confidence`, `email_source`; `candidates.preferences` extended with Gmail OAuth2 fields
**Testing**: Vitest + @testing-library/react (Next.js route handlers + UI components), pytest + pytest-asyncio (Python agent nodes + DB functions)
**Target Platform**: Next.js 15 App Router (UI extension + 6 new API routes) + Python polling daemon (Hunter.io discovery, email generation, Gmail send, reply/bounce detection)
**Project Type**: Dual-runtime web application (Next.js + Python daemon) — extends F4/F5 architecture
**Performance Goals**: Email drafts generated and ready for HITL approval within 60 seconds of job approval; Day 3/7 auto-fire within ±3 minutes of scheduled time (SC-003 requires ±15min); zero emails sent without explicit candidate approval (SC-004)
**Constraints**: 20 emails/day cap across all cadences for a candidate (FR-016); Gmail OAuth2 token required — assumed pre-configured in onboarding (out of scope); Hunter.io confidence threshold ≥ 70% for auto-send, lower triggers manual override (FR-002); Day 3 forbidden phrases: "following up", "checking in" (FR-005); Day 7 forbidden pressure phrases (FR-006); Day 1 must attach resume + cover letter PDFs — blocked if F10 PDF not yet generated
**Scale/Scope**: Single candidate, ~10–50 approved jobs per pipeline run; 20/day email cap naturally limits volume; reply/bounce detection polls hourly

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. HITL-First | ✅ PASS | One mandatory HITL gate: candidate must explicitly approve all three drafts before Day 1 fires. Zero auto-send on approval. Low-confidence email addresses surface a second decision point (Send Anyway override). No email fires without candidate action. |
| II. Agent Modularity | ✅ PASS | `outreach_mailer` is a new independent LangGraph sub-graph with clearly defined input (`job_id`, `candidate_id`, `company`, `archetype`) and output (`email_cadences` + `email_drafts` rows). No coupling to resume builder or LinkedIn connector. Both F5 and F6 trigger concurrently on job approval — neither blocks the other. |
| III. Factual Integrity | ✅ PASS | No resume or factual data is generated. LLM generates outreach email bodies (free-form persuasive text). The self-review Pydantic validator rejects forbidden phrases and word count violations. No CV facts (job titles, metrics, dates) are included in email bodies — only the candidate's archetype and relevant proof point descriptions. |
| IV. Observability | ✅ PASS | All Hunter.io API calls logged via structlog with credits consumed. LiteLLM generation + self-review calls traced via LangSmith (dev). All cadence lifecycle transitions recorded in `email_cadences` with timestamps. All email send events recorded in `email_drafts.sent_at`. |
| V. Provider-Agnostic LLM | ✅ PASS | Email generation uses LiteLLM in the Python agent (consistent with scoring engine and F5 note generation). Next.js route handlers do not make LLM calls. |
| VI. Technology Standards | ✅ PASS | Drizzle migrations for `email_cadences` and `email_drafts`, shadcn/ui components for outreach panel, Tailwind v4. New Python packages: `google-api-python-client`, `google-auth` (official Gmail client). No new Next.js dependencies. |
| VII. Dual-Runtime | ✅ PASS | Next.js owns all UI + 6 new API route handlers. Python daemon owns Hunter.io discovery, LiteLLM generation, Gmail send, and reply/bounce polling. All state flows exclusively through DB — no HTTP between runtimes. |

*Post-Phase-1 re-check: All gates remain green. F10 PDF dependency (Day 1 attachment) is handled gracefully: if no PDF exists at send time, cadence transitions to `attachment_missing` and retries every 5 minutes. Gmail OAuth2 token storage in `candidates.preferences` is an MVP simplification — v2 will move to a dedicated secrets table.*

## Project Structure

### Documentation (this feature)

```text
specs/006-outreach-mailer-agent/
├── spec.md              ← Feature specification
├── plan.md              ← This file
├── research.md          ← Phase 0: Hunter.io strategy, Gmail API, tracking, scheduling
├── data-model.md        ← Phase 1: email_cadences + email_drafts schema, state machines, TS types
├── quickstart.md        ← Phase 1: Integration scenarios for testing
├── contracts/
│   └── api.md           ← Phase 1: 6 new routes + Python daemon internals
└── tasks.md             ← Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (additions for this feature)

```text
src/
├── app/
│   └── api/
│       ├── email-cadence/
│       │   └── [cadenceId]/
│       │       ├── approve/route.ts              ← POST: approve all 3 drafts + schedule Day 1
│       │       ├── override-email/route.ts       ← POST: manual override for low-confidence email
│       │       ├── drafts/
│       │       │   └── [draftId]/route.ts        ← PATCH: edit draft body
│       │       └── route.ts                      ← GET: full cadence status + drafts
│       └── track/
│           ├── open/
│           │   └── [draftId]/route.ts            ← GET: 1×1 tracking pixel
│           └── click/
│               └── [draftId]/route.ts            ← GET: click redirect + tracking
├── components/
│   └── pipeline/
│       ├── EmailOutreachPanel.tsx                ← NEW: 3-draft preview, edit, approve section
│       ├── EmailDraftCard.tsx                    ← NEW: single draft display with edit textarea
│       ├── EmailCadenceStatusBadge.tsx           ← NEW: cadence status badge
│       └── JobReviewCard.tsx                     ← MODIFY: add emailCadence prop + EmailOutreachPanel
├── lib/
│   ├── api.ts                                    ← MODIFY: add getEmailCadence, approveCadence,
│   │                                                         updateDraft, overrideEmail
│   └── email-cadence-helpers.ts                  ← NEW: status labels, badge colour map
├── types/
│   └── candidate.ts                              ← MODIFY: add EmailCadenceStatus, EmailCadenceSummary,
│                                                             EmailDraftSummary, EmailDraftStatus;
│                                                             gmail_* fields in Preferences
└── db/
    └── schema.ts                                 ← MODIFY: add emailCadences + emailDrafts tables,
                                                              emailCadenceStatusEnum + emailDraftStatusEnum,
                                                              extend outreachTargets with email fields

agent/
└── agent/
    ├── nodes/
    │   └── outreach_mailer.py                    ← NEW: LangGraph sub-graph nodes
    │       ├── discover_email_node()                  generate_emails_node()
    │       ├── self_review_node()                     write_cadence_checkpoint_node()
    ├── hunter_io.py                              ← NEW: Hunter.io API client (Finder + Domain Search)
    ├── gmail_client.py                           ← NEW: Gmail API client (send + MIME builder + polling)
    ├── db_sqlite.py                              ← MODIFY: add insert_email_cadence,
    │                                                         update_email_cadence,
    │                                                         insert_email_drafts,
    │                                                         get_scheduled_drafts,
    │                                                         get_active_cadences_for_polling,
    │                                                         get_daily_email_send_count
    ├── db_pg.py                                  ← MODIFY: same functions for PostgreSQL
    └── daemon.py                                 ← MODIFY: add _outreach_send_loop (3min poll),
                                                              _reply_bounce_detection_loop (60min poll),
                                                              add outreach_mailer to job type handler

migrations/                                      ← Generated by drizzle-kit generate
migrations/sqlite/                               ← Generated by db:generate:sqlite

agent/tests/
└── unit/
    ├── test_db_email_cadence.py                  ← NEW: insert/update cadence + draft DB tests
    ├── test_outreach_mailer_nodes.py             ← NEW: node tests (mocked Hunter.io + LiteLLM)
    ├── test_gmail_client.py                      ← NEW: MIME builder, send, threading header tests
    └── test_daemon_outreach.py                   ← NEW: send loop + reply/bounce detection loop tests

src/__tests__/
├── api/
│   ├── email-cadence/
│   │   ├── approve.test.ts                       ← NEW: approve flow, 409, 422 cases
│   │   ├── override-email.test.ts                ← NEW: low-confidence override flow
│   │   ├── update-draft.test.ts                  ← NEW: PATCH draft, 409 already-sent case
│   │   └── status.test.ts                        ← NEW: GET cadence with drafts
│   └── track/
│       ├── open.test.ts                          ← NEW: tracking pixel, idempotency
│       └── click.test.ts                         ← NEW: redirect + tracking
└── components/
    └── pipeline/
        ├── EmailOutreachPanel.test.tsx            ← NEW: draft preview, edit, approve, status badges
        └── EmailCadenceStatusBadge.test.tsx       ← NEW: all status variants
```

**Structure Decision**: Dual-runtime. Next.js owns 6 new API route handlers (cadence approve, override-email, draft PATCH, cadence GET; open and click tracking) and 3 new UI components (EmailOutreachPanel, EmailDraftCard, EmailCadenceStatusBadge) integrated into the existing JobReviewCard. Python daemon gains a new LangGraph sub-graph (`outreach_mailer`), two new external API clients (Hunter.io, Gmail), new DB functions, and two new daemon coroutines (send loop every 3 minutes, reply/bounce detection every 60 minutes). All communication flows exclusively through the `email_cadences` and `email_drafts` tables.

## Complexity Tracking

> **No constitution violations.** Two noted MVP simplifications:

| Item | Rationale | Why acceptable |
|---|---|---|
| Gmail OAuth2 token in `candidates.preferences` | MVP scope: single-tenant, trusted-user product | Consistent with F5 LinkedIn token approach; v2 will add dedicated secrets table with encryption |
| F10 PDF dependency for Day 1 | Resume builder may not have completed when Day 1 fires | Graceful: daemon retries every 5min for 1h before surfacing `attachment_missing` to candidate — no hard failure |
