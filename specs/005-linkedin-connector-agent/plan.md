# Implementation Plan: LinkedIn Connector Agent (F5)

**Branch**: `005-linkedin-connector-agent` | **Date**: 2026-05-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/005-linkedin-connector-agent/spec.md`

## Summary

The LinkedIn Connector Agent runs automatically after a job is approved (F4 HITL gate). It uses Proxycurl to discover the most relevant hiring manager at the target company (CAIO → CTO → VP AI → Head of AI → Engineering Director → HR/Talent Acquisition fallback), enriches their profile, and uses LiteLLM to generate two distinct A/B connection note variants (each ≤300 chars, each personalised from enrichment data). Both variants are surfaced on the existing HITL dashboard card for the candidate to select and send. The actual LinkedIn connection request fires via the official LinkedIn Invitations API using the candidate's pre-authorised OAuth token. A daily 20/day cap is enforced; exceeding it queues the send for the next day. A Python daemon coroutine polls acceptance status every 24 hours. Do-not-contact companies are checked first — no API calls fire for DNC-listed companies.

## Technical Context

**Language/Version**: TypeScript 5 + Node.js 22 (Next.js), Python 3.11+ (LangGraph agent daemon)
**Primary Dependencies**: Next.js 15 App Router, Drizzle ORM, Tailwind CSS v4, shadcn/ui, Lucide React, Vitest + @testing-library/react (Next.js); LangGraph 0.4+, LiteLLM 1.40+, asyncpg/aiosqlite, Pydantic v2 (Python agent)
**Storage**: Neon PostgreSQL (prod) / SQLite (dev) — new `outreach_targets` table; `candidates.preferences` extended with `linkedin_access_token`, `linkedin_paused`, `do_not_contact_companies`
**Testing**: Vitest + @testing-library/react (Next.js route handlers + UI components), pytest + pytest-asyncio (Python agent nodes + DB functions)
**Target Platform**: Next.js 15 App Router (UI extension + 4 new API routes) + Python polling daemon (LinkedIn discovery, enrichment, note gen, acceptance polling)
**Project Type**: Dual-runtime web application (Next.js + Python daemon) — extends F4 architecture
**Performance Goals**: Note variants generated within 30 seconds of enrichment completion (SC-002); zero unauthorised sends (SC-003, 100% HITL compliance); ≥90% of approved jobs have a contact identified or documented reason (SC-005)
**Constraints**: 20 connection requests/day cap enforced via DB count check before every send (FR-009); LinkedIn OAuth token required — out of scope to obtain in this feature; Proxycurl does not provide recent posts or shared connections (workaround: use tenure + education hooks); connection note MUST NOT contain "I saw your job posting" or equivalent (FR-007)
**Scale/Scope**: Single candidate, ~10–50 approved jobs per pipeline run; 20/day LinkedIn cap naturally limits volume

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. HITL-First | ✅ PASS | Two HITL gates: (1) job approval (F4, already built), (2) note selection + Send confirmation. No connection request fires without explicit candidate selection and click. Zero auto-send. |
| II. Agent Modularity | ✅ PASS | `linkedin_connector` is a new, independent LangGraph sub-graph with clearly defined input (`job_id`, `candidate_id`, `company`, `archetype`) and output (`outreach_targets` row). No coupling to resume builder or scoring agents. |
| III. Factual Integrity | ✅ PASS | No resume or factual data is generated. LLM only generates connection notes (free-form outreach text). The Pydantic validator rejects notes containing forbidden phrases. No CV facts are included in notes. |
| IV. Observability | ✅ PASS | All Proxycurl calls logged via structlog with credits consumed. LiteLLM calls traced via LangSmith (dev). All outreach lifecycle transitions (pending → notes_ready → sent → accepted) recorded in `outreach_targets` with timestamps. |
| V. Provider-Agnostic LLM | ✅ PASS | Note generation uses LiteLLM in the Python agent (consistent with existing scoring engine). Next.js routes do not make LLM calls. |
| VI. Technology Standards | ✅ PASS | Drizzle migration for `outreach_targets`, shadcn/ui components for note selector, Tailwind v4. No new packages beyond `httpx` (for Proxycurl HTTP calls in Python). |
| VII. Dual-Runtime | ✅ PASS | Next.js owns all UI + 4 new API route handlers. Python daemon owns discovery, enrichment, note generation, and acceptance polling. All state flows exclusively through DB — no HTTP between runtimes. |

*Post-Phase-1 re-check: All gates remain green. Proxycurl read-only limitation (no recent posts/shared connections) is documented in research.md Decision 2. Note generation gracefully falls back to tenure + education hooks per FR-006 edge case.*

## Project Structure

### Documentation (this feature)

```text
specs/005-linkedin-connector-agent/
├── spec.md              ← Feature specification
├── plan.md              ← This file
├── research.md          ← Phase 0: API strategy, note gen, rate limiting, DNC
├── data-model.md        ← Phase 1: outreach_targets schema, state machine, TS types
├── quickstart.md        ← Phase 1: Integration scenarios for testing
├── contracts/
│   └── api.md           ← Phase 1: 4 new routes + Python daemon internals
└── tasks.md             ← Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (additions for this feature)

```text
src/
├── app/
│   └── api/
│       ├── outreach/
│       │   └── [targetId]/
│       │       ├── select-and-send/route.ts   ← POST: select note + send connection request
│       │       ├── regenerate/route.ts         ← POST: re-queue note generation
│       │       └── route.ts                    ← GET: outreach target status
│       └── linkedin/
│           ├── status/route.ts                 ← GET: integration status (connected, daily count, paused)
│           └── resume/route.ts                 ← POST: clear linkedin_paused flag
├── components/
│   └── pipeline/
│       ├── OutreachNoteSelector.tsx            ← Note A/B radio selector + edit textarea + Send btn
│       ├── OutreachStatusBadge.tsx             ← Status badge: sent/queued/accepted/no_contact/etc.
│       └── JobReviewCard.tsx                   ← MODIFY: add outreachTarget prop + OutreachNoteSelector
├── lib/
│   ├── api.ts                                  ← MODIFY: add getOutreachTarget, selectAndSend,
│   │                                                       getLinkedInStatus, resumeLinkedIn
│   └── outreach-helpers.ts                     ← NEW: outreach status labels, badge colour map
├── types/
│   └── candidate.ts                            ← MODIFY: add OutreachStatus, OutreachTargetSummary
│                                                          add do_not_contact_companies, linkedin_paused
│                                                          to Preferences interface
└── db/
    └── schema.ts                               ← MODIFY: add outreachTargets table + outreachStatusEnum
                                                           add outreach fields to Preferences type

agent/
└── agent/
    ├── nodes/
    │   └── linkedin_connector.py               ← NEW: LangGraph sub-graph nodes
    │       ├── check_dnc_node()                   discover_contact_node()
    │       ├── enrich_profile_node()              generate_notes_node()
    │       └── write_checkpoint_node()
    ├── proxycurl.py                            ← NEW: Proxycurl API client (employee search + enrichment)
    ├── linkedin_api.py                         ← NEW: LinkedIn OAuth API client (send + poll acceptance)
    ├── db_sqlite.py                            ← MODIFY: add insert_outreach_target,
    │                                                       update_outreach_target,
    │                                                       get_queued_outreach_targets,
    │                                                       get_sent_outreach_targets_for_polling,
    │                                                       get_daily_send_count
    ├── db_pg.py                                ← MODIFY: same functions for PostgreSQL
    └── daemon.py                               ← MODIFY: add _linkedin_acceptance_poll_loop,
                                                            _linkedin_queued_send_loop,
                                                            add linkedin_connector job type to handler

migrations/                                    ← Generated by drizzle-kit generate
migrations/sqlite/                             ← Generated by db:generate:sqlite

agent/tests/
└── unit/
    ├── test_db_linkedin.py                     ← NEW: insert/update outreach_target DB tests
    ├── test_linkedin_connector_nodes.py        ← NEW: node unit tests with mocked Proxycurl + LiteLLM
    └── test_daemon_linkedin.py                 ← NEW: acceptance poll loop + queued send loop tests

src/__tests__/
├── api/
│   └── outreach/
│       ├── select-and-send.test.ts             ← NEW: happy path, 409, 403, 422 cases
│       ├── regenerate.test.ts                  ← NEW: re-queue flow
│       └── status.test.ts                      ← NEW: GET outreach target
└── components/
    └── pipeline/
        └── OutreachNoteSelector.test.tsx       ← NEW: note selection, edit, send, status badges
```

**Structure Decision**: Dual-runtime. Next.js owns 5 new API route handlers (outreach select-send, regenerate, status; linkedin status, resume) and 2 new UI components (OutreachNoteSelector, OutreachStatusBadge) integrated into the existing JobReviewCard. Python daemon gains a new LangGraph sub-graph (`linkedin_connector`), two new external API clients (Proxycurl, LinkedIn), new DB functions, and two new daemon coroutines (acceptance polling, queued send processing). All communication flows exclusively through the `outreach_targets` table.

## Complexity Tracking

No constitution violations. One noted limitation: Proxycurl does not return recent posts or shared connections (documented in research.md Decision 2). This affects FR-004 but is mitigated by the spec's own edge case: "if no hooks exist, notes rely on the candidate's most relevant proof point for the company's context." The Pydantic validator and generation prompt are designed to generate high-quality notes from available signals (tenure + education + archetype match) when richer hooks are unavailable.

The LinkedIn write API requires OAuth 2.0 partner access. The spec explicitly declares this out of scope ("assumed to be handled in an onboarding step"). Implementation stores the access token in `candidates.preferences.linkedin_access_token` for MVP; a dedicated secrets table is deferred to a v2 security hardening pass.
