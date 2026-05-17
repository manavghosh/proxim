# Tasks: LinkedIn Connector Agent (F5)

**Input**: Design documents from `specs/005-linkedin-connector-agent/`
**Branch**: `005-linkedin-connector-agent`
**Date**: 2026-05-06
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data Model**: [data-model.md](data-model.md) | **Contracts**: [contracts/api.md](contracts/api.md) | **Research**: [research.md](research.md)

> **Skill gates embedded below.**
> — Before any implementation task: invoke `superpowers:test-driven-development`
> — Before any PR/completion claim: invoke `superpowers:verification-before-completion`
> — On any bug or test failure: invoke `superpowers:systematic-debugging`
> — On 2+ independent tasks: invoke `superpowers:dispatching-parallel-agents`

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Parallelisable (different files, no unresolved dependencies)
- **[Story]**: Which user story this task serves (US1/US2)
- **TDD gate** 🔴→🟢: Write the failing test first, confirm it fails, then implement

---

## Phase 1: Setup — Schema + Migrations

**Purpose**: Add `outreach_targets` table and `outreachStatusEnum` to both Drizzle schemas; extend `Preferences` and TypeScript types. These are prerequisites for ALL user story phases.

- [x] T001 Add `outreachStatusEnum` pgEnum to `src/db/schema.ts` with 13 values: `pending`, `discovering`, `enriching`, `generating`, `notes_ready`, `sent`, `queued`, `accepted`, `expired`, `paused`, `no_contact_found`, `skipped_dnc`, `failed`
- [x] T002 Add `outreachTargets` table to `src/db/schema.ts` per data-model.md: columns `id` (uuid PK), `jobId` (uuid FK → jobs, unique), `candidateId` (uuid FK → candidates), `name` (text nullable), `linkedinUrl` (text nullable), `title` (text nullable), `company` (text notNull), `seniority` (text nullable), `enrichmentJson` (jsonb `.$type<ProxycurlPersonEnrichment>()`), `noteA` (text nullable), `noteB` (text nullable), `selectedNote` (text nullable), `editedNote` (text nullable), `status` (outreachStatusEnum default `'pending'`), `sentAt` (timestamp nullable), `acceptedAt` (timestamp nullable), `lastPolledAt` (timestamp nullable), `linkedinInvitationId` (text nullable), `errorMessage` (text nullable), `createdAt` (timestamp defaultNow), `updatedAt` (timestamp defaultNow); add `uniqueIndex` on `jobId`; add `index` on `(candidateId, status)` and `sentAt`; export `OutreachTarget = typeof outreachTargets.$inferSelect`
- [x] T003 [P] Add `outreachTargets` table to `src/db/schema.sqlite.ts` using SQLite types per data-model.md: all same columns using `text()` for IDs, dates (ISO string), and jsonb; `status` as `text().default('pending').notNull()`; same indexes; export type
- [x] T004 [P] Add `ProxycurlPersonEnrichment` TypeScript type to `src/db/schema.ts` per data-model.md: `{ full_name, headline, summary, experiences: Array<{title, company, starts_at, ends_at}>, education: Array<{degree_name, school, ends_at}> }`
- [x] T005 [P] Extend `Preferences` interface in `src/types/candidate.ts`: add `linkedin_access_token?: string`, `linkedin_paused?: boolean`, `do_not_contact_companies?: string[]`
- [x] T006 [P] Add `OutreachStatus` union type and `OutreachTargetSummary` interface to `src/types/candidate.ts` per data-model.md section 5: `OutreachStatus = 'pending' | 'discovering' | ... | 'failed'`; `OutreachTargetSummary = { id, status: OutreachStatus, name, linkedinUrl, title, seniority, noteA, noteB, selectedNote, editedNote, sentAt, acceptedAt, errorMessage }`
- [x] T007 Run `npm run db:generate` — review generated migration for `outreach_targets` in `migrations/`; run `npm run db:generate:sqlite`; confirm both migration files include all 20 columns and 3 indexes
- [x] T008 Apply SQLite migration: run `npm run db:migrate:sqlite`; confirm `outreach_targets` table created in `proxim-dev.db` by running `python -c "import sqlite3; c=sqlite3.connect('proxim-dev.db'); print(c.execute(\"SELECT name FROM sqlite_master WHERE name='outreach_targets'\").fetchone())"`
- [x] T009 Apply Neon migration via MCP `mcp__neon__run_sql`: read generated `.sql` migration file; execute each statement against project `soft-glade-88914165`; verify with `SELECT table_name FROM information_schema.tables WHERE table_name='outreach_targets'`; verify `outreach_status` enum exists via `SELECT * FROM pg_type WHERE typname='outreach_status'`
- [x] T010 Run `npx tsc --noEmit` — confirm zero TypeScript errors after schema additions

**Checkpoint ✅**: `outreach_targets` table exists in both SQLite and Neon; `outreachStatusEnum` created; `OutreachTarget`, `OutreachTargetSummary`, `OutreachStatus` types exported; TypeScript clean.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Python API clients, DB helper functions, daemon wiring, Next.js API client extensions, and the approve-route extension that all user story phases depend on.

> ⚠️ **CRITICAL**: No user story work can begin until this phase is complete.

- [x] T011 Create `agent/agent/proxycurl.py`: async Proxycurl client using `httpx.AsyncClient`; implement `search_employees(company_name: str, role: str, api_key: str) -> dict | None` — `GET https://nubela.co/proxycurl/api/v2/linkedin/company/employees/` with params `{company_name, role, enrich_profiles='enrich'}`; returns first result or None; implement `enrich_profile(linkedin_url: str, api_key: str) -> dict | None` — `GET https://nubela.co/proxycurl/api/v2/linkedin/person/` with `{linkedin_profile_url: linkedin_url}`; both functions log credits consumed via structlog; handle HTTP errors (429 → raise `ProxycurlRateLimitError`, other non-200 → log + return None)
- [x] T012 Create `agent/agent/linkedin_api.py`: async LinkedIn OAuth client using `httpx.AsyncClient`; implement `send_connection_request(access_token: str, profile_id: str, message: str) -> str` — `POST https://api.linkedin.com/v2/invitations`; returns LinkedIn invitation ID on success; raises `LinkedInRateLimitError` on 429; raises `LinkedInAPIError` on other errors; implement `get_invitation_status(access_token: str, invitation_id: str) -> str` — `GET https://api.linkedin.com/v2/invitations/{id}`; returns status string (`PENDING` | `ACCEPTED` | `WITHDRAWN` | `EXPIRED`)
- [x] T013 [P] Add SQLite DB functions to `agent/agent/db_sqlite.py`: `insert_outreach_target(pool, job_id, candidate_id, company) -> str` (INSERT with status=`pending`, return id); `update_outreach_target(pool, target_id, **kwargs)` (dynamic UPDATE per data-model); `get_queued_outreach_targets(pool, candidate_id) -> list[dict]` (SELECT WHERE status=`queued`); `get_sent_outreach_targets_for_polling(pool) -> list[dict]` (SELECT WHERE status=`sent` AND (last_polled_at IS NULL OR last_polled_at < datetime('now','-24 hours'))); `get_daily_send_count(pool, candidate_id) -> int` (COUNT WHERE status=`sent` AND date(sent_at)=date('now'))
- [x] T014 [P] Add PostgreSQL DB functions to `agent/agent/db_pg.py`: same 5 functions as T013 using asyncpg `$1/$2` placeholders and `pool.acquire()` context manager; use `CURRENT_DATE` instead of `date('now')`; use `INTERVAL '24 hours'` instead of `datetime modifier`
- [x] T015 Extend `src/app/api/jobs/[jobId]/approve/route.ts`: after the existing `pipeline_jobs` INSERT for `resume_builder`, add a second INSERT `pipeline_jobs (job_type='linkedin_connector', candidateId, payload={job_id, candidate_id, company, job_title, archetype, archetype_confidence})`; read `company`, `job_title`, `archetype`, `archetype_confidence` from the jobs SELECT that already runs earlier in the same handler
- [x] T016 [P] Extend `GET /api/candidates/[id]/jobs` route in `src/app/api/candidates/[id]/jobs/route.ts`: add LEFT JOIN on `outreach_targets` (matching `outreach_targets.job_id = jobs.id`); for approved jobs include `outreachTarget: OutreachTargetSummary | null` in each job object; non-approved jobs return `outreachTarget: null`
- [x] T017 [P] Add to `src/lib/api.ts`: `getOutreachTarget(targetId: string, candidateId: string) -> Promise<OutreachTargetFull>` → `GET /api/outreach/[targetId]?candidateId=`; `selectAndSendNote(targetId: string, candidateId: string, selectedNote: 'A' | 'B', editedNote?: string) -> Promise<{status: OutreachStatus}>` → `POST /api/outreach/[targetId]/select-and-send?candidateId=`; `regenerateNotes(targetId: string, candidateId: string) -> Promise<{status: string}>` → `POST /api/outreach/[targetId]/regenerate?candidateId=`; `getLinkedInStatus(candidateId: string) -> Promise<LinkedInStatus>` → `GET /api/linkedin/status?candidateId=`; `resumeLinkedIn(candidateId: string) -> Promise<void>` → `POST /api/linkedin/resume?candidateId=`
- [x] T018 [P] Create `src/lib/outreach-helpers.ts`: export `OUTREACH_STATUS_LABELS: Record<OutreachStatus, string>` mapping each status to a user-friendly label (e.g. `notes_ready` → `'Select & Send'`, `sent` → `'Sent · Pending'`, `accepted` → `'Connected ✓'`, `no_contact_found` → `'No contact found'`, `skipped_dnc` → `'Do-not-contact'`, `paused` → `'LinkedIn paused'`); export `OUTREACH_STATUS_BADGE_VARIANT: Record<OutreachStatus, string>` mapping status to Badge colour class (accepted → `'bg-emerald-100 text-emerald-800'`, notes_ready → `'bg-blue-100 text-blue-800'`, sent/queued → `'bg-yellow-100 text-yellow-800'`, no_contact_found/skipped_dnc → `'bg-gray-100 text-gray-500'`, failed/paused → `'bg-red-100 text-red-800'`)
- [x] T019 Run `npx tsc --noEmit` — confirm zero TypeScript errors

**Checkpoint ✅ Foundation Ready**: Python API clients created; all DB functions added; approve route extended to enqueue linkedin_connector; GET jobs extended with outreachTarget; frontend API client updated; TypeScript clean.

---

## Phase 3: User Story 1 — Hiring Manager Discovery and Connection Note (Priority: P1) 🎯 MVP

**Goal**: After a job is approved, the Python agent automatically discovers the most relevant decision-maker at the company via Proxycurl (with DNC and fallback logic), enriches their profile, and generates two A/B connection note variants using LiteLLM. Both variants appear on the approved job card in the dashboard.

**Independent Test**: Approve a fixture job; insert a matching `pipeline_jobs` row with `job_type='linkedin_connector'`; start the Python daemon; verify `outreach_targets.status = 'notes_ready'` with non-empty `note_a` and `note_b`, each ≤ 300 characters. Can be tested without real Proxycurl/LiteLLM using mocked DB fixtures.

> 🔵 Invoke `superpowers:test-driven-development` before T021, T025.

### 3A — Python DB Tests

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T021.

- [x] T020 [P] [US1] Write failing tests in `agent/tests/unit/test_db_linkedin.py`: `test_insert_outreach_target_creates_pending_row`; `test_update_outreach_target_sets_status`; `test_get_daily_send_count_returns_zero_when_no_sends`; `test_get_daily_send_count_returns_correct_count_for_today`; `test_get_queued_outreach_targets_returns_only_queued` — use in-memory SQLite fixture with `outreach_targets`, `jobs`, `candidates` tables
- [x] T021 [US1] Run `poetry run pytest agent/tests/unit/test_db_linkedin.py -v` — confirm all FAIL 🔴
- [x] T022 [US1] Implement the 5 SQLite DB functions declared in T013 in `agent/agent/db_sqlite.py`; run `poetry run pytest agent/tests/unit/test_db_linkedin.py -v` — confirm all PASS 🟢

### 3B — LinkedIn Connector LangGraph Nodes

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T025.

- [x] T023 [P] [US1] Write failing tests in `agent/tests/unit/test_linkedin_connector_nodes.py` with mocked Proxycurl + LiteLLM: `test_check_dnc_node_marks_skipped_dnc_when_company_in_list`; `test_check_dnc_node_passes_through_when_company_not_in_list`; `test_discover_contact_node_searches_roles_in_priority_order` (CAIO first); `test_discover_contact_node_falls_back_to_hr_when_no_technical_contact`; `test_discover_contact_node_marks_no_contact_found_when_all_roles_exhausted`; `test_enrich_profile_node_stores_enrichment_json`; `test_generate_notes_node_produces_two_variants_under_300_chars`; `test_generate_notes_node_retries_when_note_exceeds_300_chars` (mock first call returning 350-char note, second call OK)
- [x] T024 [US1] Run `poetry run pytest agent/tests/unit/test_linkedin_connector_nodes.py -v` — confirm all FAIL 🔴
- [x] T025 [P] [US1] Create `agent/agent/nodes/linkedin_connector.py`: define `LinkedInConnectorState(TypedDict)` per data-model.md section 4; implement `check_dnc_node(state, config)` — load `preferences.do_not_contact_companies` via `get_candidate_preferences`; if company in list (case-insensitive) → `update_outreach_target(pool, id, status='skipped_dnc')`, set `state.status='skipped_dnc'`; implement `discover_contact_node(state, config)` — call `proxycurl.search_employees` for each role in priority order [CAIO, CTO, VP AI, Head of AI, Engineering Director, HR/Talent Acquisition]; stop at first result; update `outreach_target` with `name`, `linkedinUrl`, `title`, `seniority`; if all roles exhausted → `status='no_contact_found'`; implement `enrich_profile_node(state, config)` — call `proxycurl.enrich_profile(linkedinUrl)`; store `enrichmentJson`; implement `generate_notes_node(state, config)` — build prompt with enrichment signals (tenure, education, archetype match); call LiteLLM with `response_format=NoteVariants` Pydantic model; Pydantic `@field_validator` rejects notes >300 chars or containing forbidden phrases; retry up to 3×; on success → `update_outreach_target(pool, id, note_a=..., note_b=..., status='notes_ready')`; on 3× failure → `status='failed'`; implement routing edges between nodes
- [x] T026 [US1] Run `poetry run pytest agent/tests/unit/test_linkedin_connector_nodes.py -v` — confirm all PASS 🟢

### 3C — Daemon Integration

- [x] T027 [US1] Modify `agent/agent/daemon.py`: add `linkedin_connector` to the job type dispatch dictionary; when `job_type == 'linkedin_connector'`: extract `payload.job_id`, `payload.company`, `payload.job_title`, `payload.archetype`; call `insert_outreach_target(pool, ...)` to create `pending` row; build `LinkedInConnectorState`; run the LangGraph nodes in sequence via `asyncio.create_task`; handle `ProxycurlRateLimitError` (log warning, update status to `failed`, error_message set); log each stage transition via structlog

### 3D — UI: Outreach Status Display

- [x] T028 [P] [US1] Create `src/components/pipeline/OutreachStatusBadge.tsx`: accepts `status: OutreachStatus | null`; returns `null` if status is null, `'pending'`, or `'discovering'`/`'enriching'`/`'generating'` (transient states — show spinner instead); uses shadcn `Badge` with colour classes from `OUTREACH_STATUS_BADGE_VARIANT` in `src/lib/outreach-helpers.ts`; shows label from `OUTREACH_STATUS_LABELS`; for `notes_ready` shows a pulsing dot to draw attention
- [x] T029 [P] [US1] Extend `src/components/pipeline/JobReviewCard.tsx`: add optional `outreachTarget?: OutreachTargetSummary | null` prop; when `outreachTarget` is non-null and job `status === 'approved'`, render an `OutreachStatusBadge` below the action buttons; when `outreachTarget.status === 'notes_ready'`, also render the `OutreachNoteSelector` component (built in US2); import `OutreachStatusBadge` from `@/components/pipeline/OutreachStatusBadge`; no prop change to existing `HitlJob` type — `outreachTarget` is already included in the F4 GET jobs response extension from T016
- [x] T030 [US1] Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T031 [US1] Run `npm run test:run` — all existing tests pass (no regressions)

**Checkpoint ✅ US1**: Approve a job via dashboard → Python daemon picks up `linkedin_connector` job → `outreach_targets` row transitions `pending → discovering → enriching → generating → notes_ready` → dashboard card for that approved job shows `OutreachStatusBadge` with current status → on `notes_ready`, badge pulses.

---

## Phase 4: User Story 2 — Candidate Reviews and Sends Connection Request (Priority: P2)

**Goal**: Candidate selects their preferred note variant (optionally edits it) and clicks Send. Connection fires via LinkedIn API, daily 20/day cap enforced, queued sends process next day, acceptance polled every 24h. LinkedIn paused state handled with dashboard banner.

**Independent Test**: Insert a fixture `outreach_targets` row with `status='notes_ready'`; call `POST /api/outreach/[targetId]/select-and-send` with `selectedNote='A'`; mock the LinkedIn API call to return a successful invitation ID; verify `outreach_targets.status='sent'` and `sentAt` populated. Can be tested without real LinkedIn credentials using mocks.

> 🔵 Invoke `superpowers:test-driven-development` before T034, T041, T046.

### 4A — Select-and-Send API Route

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T034.

- [x] T032 [P] [US2] Write failing tests in `src/__tests__/api/outreach/select-and-send.test.ts`: `test_returns_200_with_sent_status_when_under_daily_limit`; `test_returns_200_with_queued_status_when_daily_limit_reached`; `test_returns_409_when_already_sent`; `test_returns_403_when_linkedin_paused`; `test_returns_422_when_not_in_notes_ready_status`; `test_uses_edited_note_when_provided`; `test_records_selected_note_variant` — mock Drizzle and `linkedin_api.send_connection_request`
- [x] T033 [US2] Run `npm run test:run -- --testPathPattern=outreach/select-and-send` — confirm all FAIL 🔴
- [x] T034 [US2] Create `src/app/api/outreach/[targetId]/select-and-send/route.ts`: `POST` handler; read `selectedNote` and `editedNote` from request body; await `params`; check `candidates.preferences.linkedin_paused` → 403 if true; conditional UPDATE `outreach_targets SET selected_note=?, edited_note=? WHERE id=? AND status='notes_ready'` → 409 if 0 rows affected; count daily sends via `SELECT COUNT(*) FROM outreach_targets WHERE candidate_id=? AND status='sent' AND sent_at::date=CURRENT_DATE` (use `date(sent_at)=date('now')` for SQLite); if count ≥ 20 → UPDATE `status='queued'` → return `{status:'queued', message:'Daily limit reached. Sends tomorrow.'}`; resolve final note text (editedNote || (selectedNote==='A' ? noteA : noteB)); call LinkedIn Invitations API `POST /v2/invitations` with candidate's `linkedin_access_token` from preferences; on success → UPDATE `status='sent'`, `sent_at=now()`, `linkedin_invitation_id=response_id`; on LinkedIn 429 → UPDATE `status='paused'`; set `candidates.preferences.linkedin_paused=true`; return `{status:'paused'}`; return `{targetId, status:'sent', sentAt}`
- [x] T035 [US2] Run `npm run test:run -- --testPathPattern=outreach/select-and-send` — confirm all PASS 🟢

### 4B — Supporting API Routes

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T041.

- [x] T036 [P] [US2] Write failing tests in `src/__tests__/api/outreach/status.test.ts`: `test_returns_200_with_full_outreach_target`; `test_returns_404_for_unknown_target`; `test_returns_403_for_wrong_candidate`
- [x] T037 [P] [US2] Write failing tests in `src/__tests__/api/outreach/regenerate.test.ts`: `test_returns_200_and_queues_regen_pipeline_job`; `test_returns_409_when_already_sent`
- [x] T038 [P] [US2] Write failing tests in `src/__tests__/api/linkedin/status.test.ts`: `test_returns_connected_true_when_access_token_present`; `test_returns_daily_sends_count`; `test_returns_paused_false_by_default`; `test_returns_queued_count`
- [x] T039 [P] [US2] Write failing tests in `src/__tests__/api/linkedin/resume.test.ts`: `test_clears_linkedin_paused_flag`; `test_returns_200`
- [x] T040 [US2] Run `npm run test:run -- --testPathPattern=(outreach/status|outreach/regenerate|linkedin/)` — confirm all FAIL 🔴
- [x] T041 [US2] Create `src/app/api/outreach/[targetId]/route.ts`: `GET` handler; SELECT `outreach_targets JOIN jobs` WHERE `outreach_targets.id=? AND candidate_id=?`; 404 if not found; 403 if candidate mismatch; return full `OutreachTargetFull` object
- [x] T042 [US2] Create `src/app/api/outreach/[targetId]/regenerate/route.ts`: `POST` handler; verify `status IN ('notes_ready','failed')` — 409 otherwise; UPDATE `outreach_targets SET status='generating'`; INSERT `pipeline_jobs (job_type='linkedin_note_regen', payload={target_id, job_id, candidate_id})`; return `{targetId, status:'generating', message:'Regenerating note variants. Refresh in ~30 seconds.'}`
- [x] T043 [US2] Create `src/app/api/linkedin/status/route.ts`: `GET` handler; read `candidateId` from query; load `candidate.preferences`; count today's sends and queued count from `outreach_targets`; return `{connected: !!access_token, paused: linkedin_paused||false, dailySendsToday, dailyLimit:20, queuedCount, doNotContactCompanies}`
- [x] T044 [US2] Create `src/app/api/linkedin/resume/route.ts`: `POST` handler; `candidateId` from query; UPDATE `candidates.preferences` to set `linkedin_paused=false`; return `{paused:false, message:'LinkedIn outreach resumed.'}`
- [x] T045 [US2] Run `npm run test:run -- --testPathPattern=(outreach/status|outreach/regenerate|linkedin/)` — confirm all PASS 🟢

### 4C — Note Selector UI Component

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T046.

- [x] T046 [P] [US2] Write failing component tests in `src/__tests__/components/pipeline/OutreachNoteSelector.test.tsx`: `test_renders_two_note_variants`; `test_selecting_variant_a_highlights_it`; `test_edit_textarea_appears_after_selection`; `test_edited_text_replaces_note_on_send`; `test_send_button_disabled_until_variant_selected`; `test_shows_queued_status_when_daily_limit_reached`; `test_shows_paused_warning_when_linkedin_paused`; `test_regenerate_button_visible_when_status_failed`
- [x] T047 [US2] Run `npm run test:run -- --testPathPattern=pipeline/OutreachNoteSelector` — confirm all FAIL 🔴
- [x] T048 [US2] Create `src/components/pipeline/OutreachNoteSelector.tsx`: `'use client'`; accepts `target: OutreachTargetSummary`, `candidateId: string`, `onStatusChange: (newStatus: OutreachStatus) => void`; renders two shadcn `Card` variants (A and B) as radio-style selectors with the note text; selected card gets a blue ring; after selection shows an optional `<Textarea>` for editing (shadcn `Textarea`); shows character count badge (max 300, red when over); Send shadcn `Button` (disabled until a variant selected); on Send → calls `selectAndSendNote(targetId, candidateId, selectedNote, editedNote||undefined)`; on success calls `onStatusChange(result.status)`; shows `Skeleton` during loading; shows `AlertBanner` with "LinkedIn paused" when `status='paused'`; shows "Regenerate" Button when `status='failed'` (calls `regenerateNotes`)
- [x] T049 [US2] Run `npm run test:run -- --testPathPattern=pipeline/OutreachNoteSelector` — confirm all PASS 🟢

### 4D — Daemon: Acceptance Polling + Queued Send Processing

- [x] T050 [P] [US2] Write failing tests in `agent/tests/unit/test_daemon_linkedin.py`: `test_acceptance_poll_loop_updates_accepted_status`; `test_acceptance_poll_loop_marks_expired_after_30_days`; `test_queued_send_loop_sends_when_under_daily_limit`; `test_queued_send_loop_skips_when_daily_limit_reached`; `test_queued_send_loop_skips_when_linkedin_paused` — mock `linkedin_api` calls
- [x] T051 [US2] Run `poetry run pytest agent/tests/unit/test_daemon_linkedin.py -v` — confirm all FAIL 🔴
- [x] T052 [US2] Add `_linkedin_acceptance_poll_loop(pool)` coroutine to `agent/agent/daemon.py`: `asyncio.sleep(86400)` interval; call `get_sent_outreach_targets_for_polling(pool)`; for each target: call `linkedin_api.get_invitation_status(access_token, invitation_id)`; if `ACCEPTED` → `update_outreach_target(pool, id, status='accepted', accepted_at=_now())`; if sent_at older than 30 days and still PENDING → `status='expired'`; otherwise update `last_polled_at=_now()`; log each status update via structlog; catch `LinkedInAPIError` → log warning, skip that record
- [x] T053 [US2] Add `_linkedin_queued_send_loop(pool)` coroutine to `agent/agent/daemon.py`: `asyncio.sleep(3600)` interval; for each candidate with queued sends: call `get_daily_send_count(pool, candidate_id)` → if count < 20, get up to `(20 - count)` queued targets; call `linkedin_api.send_connection_request(access_token, profile_id, note)` for each; on success → `update_outreach_target(pool, id, status='sent', sent_at=_now(), linkedin_invitation_id=...)`; on `LinkedInRateLimitError` → `update_outreach_target(pool, id, status='paused')`; update `candidates.preferences.linkedin_paused=True` via DB; catch exceptions and log without stopping loop
- [x] T054 [US2] Add `_linkedin_queued_send_loop` and `_linkedin_acceptance_poll_loop` to `asyncio.gather` in `agent/agent/daemon.py` `main()` function alongside existing job polling and snooze resurface loops
- [x] T055 [US2] Run `poetry run pytest agent/tests/unit/test_daemon_linkedin.py -v` — confirm all PASS 🟢

### 4E — Integration

- [x] T056 [US2] Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T057 [US2] Run `npm run test:run` — all tests pass (no regressions)

**Checkpoint ✅ US2**: Insert fixture `outreach_targets` with `status='notes_ready'`; open Pipeline page; approved job card shows `OutreachNoteSelector`; select Variant A; click Send; verify `status='sent'` in DB; verify badge changes to "Sent · Pending"; set `linkedin_paused=true`; verify warning banner appears and Send is blocked; call `POST /api/linkedin/resume`; verify banner dismisses.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Observability, DNC preferences UI, LinkedIn status settings badge, final verification.

> 🔵 Invoke `superpowers:verification-before-completion` at T065 before final commit.

- [x] T058 [P] Add structlog logging to `agent/agent/nodes/linkedin_connector.py`: log each Proxycurl call with `company`, `role`, `credits_consumed`; log note generation attempts with attempt number; log `status` transition at each node; log DNC skips at INFO; log Proxycurl rate-limit at WARNING
- [x] T059 [P] Add `data-testid` attributes to key elements in `OutreachNoteSelector.tsx`: `data-testid="note-variant-a"`, `data-testid="note-variant-b"`, `data-testid="note-edit-textarea"`, `data-testid="note-send-btn"`, `data-testid="note-regenerate-btn"`, `data-testid="linkedin-paused-banner"` — for future E2E tests
- [x] T060 [P] Add `data-testid` attributes to `OutreachStatusBadge.tsx`: `data-testid="outreach-status-badge"` — and to the outreach section in `JobReviewCard.tsx`: `data-testid="outreach-section"`
- [x] T061 [P] Add `linkedin_note_regen` job type handler to `agent/agent/daemon.py`: when `job_type='linkedin_note_regen'`, fetch existing `outreach_target` by `target_id` from payload; re-run `enrich_profile_node` and `generate_notes_node` with fresh LiteLLM call; update `note_a`, `note_b`, `status='notes_ready'` on success; `status='failed'` on 3× failure
- [x] T062 [P] Create `agent/agent/db_pg.py` implementations of all 5 functions from T014 — verify PostgreSQL-specific SQL correctness (use `$1` params, `CURRENT_DATE`, `INTERVAL`, `asyncpg` `acquire()` pattern)
- [x] T063 Run full Next.js test suite: `npm run test:run` — all tests pass
- [x] T064 Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T065 🔵 **Invoke `superpowers:verification-before-completion`** — run `npm run test:run`, `npx tsc --noEmit`, `npm run build`; all must pass with evidence
- [ ] T066 Manual smoke test per `quickstart.md` Scenario 1: start daemon + `npm run dev`; approve a job via dashboard; verify `outreach_targets` row created; wait for `notes_ready`; select a note variant; click Send; verify `status='sent'` in DB; verify badge updates
- [ ] T067 Manual smoke test per `quickstart.md` Scenario 2: add company to DNC list; approve a job at that company; verify `outreach_targets.status='skipped_dnc'`; verify "Do-not-contact" badge on card
- [ ] T068 Final commit: `git add -A && git commit -m "feat: LinkedIn connector agent — F5 complete"`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup — DB schema, migrations, TS types)
    └─► Phase 2 (Foundational — Python API clients, DB functions, approve route extension, API client)
              └─► Phase 3 (US1 — Discovery, enrichment, note generation, status badge) 🎯 MVP
                        └─► Phase 4 (US2 — Select-and-send, acceptance polling, queued send loop)
                                  └─► Phase 5 (Polish)
```

### User Story Dependencies

- **US1 (P1)**: Requires Phases 1–2 complete. Delivers the full Python pipeline: DNC check → Proxycurl discovery → enrichment → LiteLLM note generation → `notes_ready`. Dashboard shows outreach status badge on approved job cards. No send functionality yet.
- **US2 (P2)**: Requires US1 complete (outreach target must reach `notes_ready`). Delivers the send path: note selector UI, select-and-send route, rate limiting, LinkedIn API call, acceptance polling, queued send loop.

### Within Each Phase

- DB migration (T007–T009) MUST complete before any Python or Next.js code that reads/writes `outreach_targets`
- Python API clients (T011–T012) MUST complete before any LangGraph node uses them
- Approve route extension (T015) MUST complete before daemon can be tested end-to-end
- Test writing MUST complete and tests MUST **FAIL** before implementation begins (TDD gates)
- TypeScript check after each phase before moving to next

### Parallel Opportunities

Within Phase 2:
- T011 (`proxycurl.py`) + T012 (`linkedin_api.py`) + T013 (SQLite DB funcs) + T014 (PG DB funcs) + T016 (GET jobs extension) + T017 (API client) + T018 (outreach-helpers) — all parallel (different files)

Within Phase 3:
- T020 (DB tests) + T023 (node tests) + T028 (OutreachStatusBadge) — all parallel (different files)
- T025 (all 5 node implementations) can be done in parallel by splitting across check_dnc, discover, enrich, generate nodes
- T027 (daemon integration) depends on T025

Within Phase 4:
- T032 (select-and-send tests) + T036 (status tests) + T037 (regenerate tests) + T038 (linkedin/status tests) + T039 (linkedin/resume tests) + T046 (note selector component tests) — all parallel
- T050 (daemon tests) can run in parallel with all Next.js test/impl tasks
- T041–T045 (route implementations) can run in parallel with each other (different files)

Polish: T058, T059, T060, T061, T062 — all parallel (different files).

---

## Parallel Example: Phase 3 (US1)

```bash
# Parallel batch 1 — write failing tests simultaneously:
Task T020: agent/tests/unit/test_db_linkedin.py
Task T023: agent/tests/unit/test_linkedin_connector_nodes.py

# Parallel batch 2 — after tests confirmed failing, implement simultaneously:
Task T022: agent/agent/db_sqlite.py  (5 DB functions)
Task T025: agent/agent/nodes/linkedin_connector.py  (5 nodes)
Task T028: src/components/pipeline/OutreachStatusBadge.tsx

# Sequential after batch 2:
Task T027: agent/agent/daemon.py  ← depends on T025
Task T029: src/components/pipeline/JobReviewCard.tsx  ← depends on T028
```

## Parallel Example: Phase 4 (US2)

```bash
# Parallel batch 1 — write all failing tests simultaneously:
Task T032: src/__tests__/api/outreach/select-and-send.test.ts
Task T036: src/__tests__/api/outreach/status.test.ts
Task T037: src/__tests__/api/outreach/regenerate.test.ts
Task T038: src/__tests__/api/linkedin/status.test.ts
Task T039: src/__tests__/api/linkedin/resume.test.ts
Task T046: src/__tests__/components/pipeline/OutreachNoteSelector.test.tsx
Task T050: agent/tests/unit/test_daemon_linkedin.py

# Parallel batch 2 — implement simultaneously:
Task T034: src/app/api/outreach/[targetId]/select-and-send/route.ts
Task T041: src/app/api/outreach/[targetId]/route.ts
Task T042: src/app/api/outreach/[targetId]/regenerate/route.ts
Task T043: src/app/api/linkedin/status/route.ts
Task T044: src/app/api/linkedin/resume/route.ts
Task T052: agent/agent/daemon.py  (_linkedin_acceptance_poll_loop)
Task T053: agent/agent/daemon.py  (_linkedin_queued_send_loop)

# Sequential after batch 2:
Task T048: src/components/pipeline/OutreachNoteSelector.tsx  ← depends on routes
```

---

## Implementation Strategy

### MVP First (US1 Only — ~3 days)

1. Complete Phase 1 (Schema + migrations — ~2 hours)
2. Complete Phase 2 (Foundation — API clients, DB functions, approve extension — ~3 hours)
3. Complete Phase 3 (US1 — Python discovery/enrichment/note-gen nodes — ~2 days)
4. **STOP and VALIDATE**: Approve a job, verify `outreach_targets.status='notes_ready'` with two note variants
5. MVP delivered: automatic hiring manager discovery and A/B note generation after job approval

### Incremental Delivery

1. Phases 1–3 → US1 MVP: discovery + note generation working end-to-end
2. Phase 4 → US2: candidate can select note, send connection request, rate limiting, acceptance tracking
3. Phase 5 → Production-hardened with logging, DNC management UI, fully verified

### Parallel Team Strategy

Once Phase 2 is complete:
- **Developer A**: Phase 3 Python nodes (check_dnc, discover, enrich, generate) + daemon integration
- **Developer B**: Phase 4 Next.js API routes (select-and-send, regenerate, status) + UI (OutreachNoteSelector)
- **Developer C**: Phase 4 Python daemon loops (acceptance polling, queued send processing)

---

## Task Tracker Summary

| Phase | Tasks | Completed | Status |
|---|---|---|---|
| Phase 1: Setup (Schema + Migrations) | T001–T010 | 10/10 | ✅ Complete |
| Phase 2: Foundational | T011–T019 | 9/9 | ✅ Complete |
| Phase 3: US1 (Discovery + Note Gen) | T020–T031 | 0/12 | ⬜ Pending |
| Phase 4: US2 (Select + Send + Poll) | T032–T057 | 0/26 | ⬜ Pending |
| Phase 5: Polish | T058–T068 | 0/11 | ⬜ Pending |
| **Total** | **T001–T068** | **0/68** | **0% complete** |

---

## Superpowers Skill Gate Summary

| Gate | When | Task ref |
|---|---|---|
| `superpowers:test-driven-development` | Before T021 (Python DB linkedin tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T025 (LinkedIn connector node tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T034 (select-and-send route tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T041 (outreach status/regen tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T046 (OutreachNoteSelector component tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T051 (daemon linkedin loop tests) | Phase 4 |
| `superpowers:systematic-debugging` | On any test failure or unexpected behaviour | Any phase |
| `superpowers:dispatching-parallel-agents` | T020+T023+T028 in parallel (Phase 3); T032+T036+T037+T038+T039+T046+T050 in parallel (Phase 4) | Phases 3–4 |
| `superpowers:verification-before-completion` | Before T066 (smoke test + final commit) | Phase 5 |
