# Tasks: Outreach Mailer Agent (F6)

**Input**: Design documents from `specs/006-outreach-mailer-agent/`
**Branch**: `006-outreach-mailer-agent`
**Date**: 2026-05-14
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

**Purpose**: Add `email_cadences` and `email_drafts` tables to both Drizzle schemas; extend `outreach_targets` with email fields; add TypeScript types. These are prerequisites for ALL phases.

- [x] T001 Add `emailCadenceStatusEnum` pgEnum to `src/db/schema.ts` with 16 values: `pending_discovery`, `discovering`, `low_confidence`, `email_not_found`, `generating`, `pending_approval`, `approved`, `active`, `paused`, `auth_expired`, `attachment_missing`, `replied`, `cadence_complete`, `bounced`, `cancelled`, `failed`
- [x] T002 Add `emailCadences` pgTable to `src/db/schema.ts` per data-model.md section 1: columns `id` (uuid PK), `jobId` (uuid FK → jobs, unique), `candidateId` (uuid FK → candidates), `hiringManagerEmail` (text nullable), `emailConfidence` (integer nullable), `emailSource` (text nullable), `gmailThreadId` (text nullable), `day1MessageId` (text nullable), `status` (emailCadenceStatusEnum default `'pending_discovery'`), `approvedAt` (timestamp nullable), `replyDetectedAt` (timestamp nullable), `bounceDetectedAt` (timestamp nullable), `errorMessage` (text nullable), `createdAt` (timestamp defaultNow), `updatedAt` (timestamp defaultNow); add `uniqueIndex` on `jobId`; add `index` on `(candidateId, status)`; export `EmailCadence = typeof emailCadences.$inferSelect`
- [x] T003 [P] Add `emailDraftStatusEnum` pgEnum to `src/db/schema.ts` with 9 values: `draft`, `approved`, `superseded`, `scheduled`, `sending`, `sent`, `bounced`, `rate_limited`, `cancelled`
- [x] T004 [P] Add `emailDrafts` pgTable to `src/db/schema.ts` per data-model.md section 2: columns `id` (uuid PK), `cadenceId` (uuid FK → emailCadences), `candidateId` (uuid FK → candidates), `dayNumber` (integer notNull), `subject` (text notNull), `bodyHtml` (text notNull), `bodyText` (text notNull), `originalBodyHtml` (text notNull), `isApproved` (boolean default false notNull), `scheduledSendAt` (timestamp nullable), `status` (emailDraftStatusEnum default `'draft'`), `sentAt` (timestamp nullable), `gmailMessageId` (text nullable), `openDetectedAt` (timestamp nullable), `clickDetectedAt` (timestamp nullable), `bounceDetectedAt` (timestamp nullable), `createdAt` (timestamp defaultNow), `updatedAt` (timestamp defaultNow); add `index` on `(cadenceId, dayNumber)`, `(candidateId, status)`, and `scheduledSendAt`; export `EmailDraft = typeof emailDrafts.$inferSelect`
- [x] T005 [P] Extend `outreachTargets` pgTable in `src/db/schema.ts`: add `email` (text nullable), `emailConfidence` (integer nullable), `emailSource` (text nullable) columns per data-model.md section 3
- [x] T006 [P] Add SQLite equivalents to `src/db/schema.sqlite.ts`: `emailCadences` and `emailDrafts` tables using `text()` for IDs/dates; status columns as `text().default(...).notNull()`; `isApproved` as `integer({ mode: 'boolean' }).default(false).notNull()`; same indexes; extend sqlite `outreachTargets` with `email`, `emailConfidence`, `emailSource` columns
- [x] T007 [P] Extend `Preferences` interface in `src/types/candidate.ts`: add `gmail_access_token?: string`, `gmail_refresh_token?: string`, `gmail_email?: string`, `gmail_token_expiry?: string`
- [x] T008 [P] Add TypeScript types to `src/types/candidate.ts` per data-model.md section 6: `EmailCadenceStatus` union (16 values); `EmailDraftStatus` union (9 values); `EmailDraftSummary` interface `{ id, dayNumber, subject, bodyHtml, originalBodyHtml, isApproved, status, scheduledSendAt, sentAt, openDetectedAt, clickDetectedAt }`; `EmailCadenceSummary` interface `{ id, status, hiringManagerEmail, emailConfidence, approvedAt, replyDetectedAt, bounceDetectedAt, drafts: EmailDraftSummary[] }`
- [x] T009 Run `npm run db:generate` — review generated migration for `email_cadences`, `email_drafts`, and `outreach_targets` email columns in `migrations/`; run `npm run db:generate:sqlite`; confirm both migration files include all columns and indexes
- [x] T010 Apply SQLite migration: run `npm run db:migrate:sqlite`; confirm `email_cadences` and `email_drafts` tables created in `proxim-dev.db`
- [x] T011 Apply Neon migration via MCP `mcp__neon__run_sql`: read generated `.sql` migration file; execute each statement against the project database; verify `email_cadences`, `email_drafts` tables exist; verify `email_cadence_status` and `email_draft_status` enums created via `SELECT * FROM pg_type WHERE typname IN ('email_cadence_status','email_draft_status')`
- [x] T012 Run `npx tsc --noEmit` — confirm zero TypeScript errors after schema additions

**Checkpoint ✅**: `email_cadences` and `email_drafts` tables exist in both SQLite and Neon; all enums created; `EmailCadence`, `EmailDraft`, `EmailCadenceSummary`, `EmailDraftSummary` types exported; TypeScript clean.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Hunter.io + Gmail Python API clients, DB helper functions, daemon wiring, Next.js API client extensions, and the approve-route extension that all user story phases depend on.

> ⚠️ **CRITICAL**: No user story work can begin until this phase is complete.

- [x] T013 Create `agent/agent/hunter_io.py`: async Hunter.io client using `httpx.AsyncClient`; implement `find_email(domain: str, first_name: str, last_name: str, api_key: str) -> dict | None` — `GET https://api.hunter.io/v2/email-finder` with params `{domain, first_name, last_name, api_key}`; returns `{email, score}` or None; implement `domain_search(domain: str, api_key: str) -> list[dict]` — `GET https://api.hunter.io/v2/domain-search` with `{domain, limit:10, api_key}`; returns list sorted by confidence; both functions log results via structlog; handle HTTP 429 → raise `HunterRateLimitError`; handle other non-200 → log + return None/empty list
- [x] T014 Create `agent/agent/gmail_client.py`: Gmail API client using `google-api-python-client` and `google-auth`; implement `build_service(access_token: str, refresh_token: str) -> Resource` — constructs `Credentials` + `build('gmail','v1',...)`; implement `send_email(service, to, subject, body_html, body_text, thread_id, in_reply_to, references, attachments) -> dict` — builds `MIMEMultipart('mixed')` for Day 1 (with PDF attachments as `application/pdf`), `MIMEMultipart('alternative')` for Day 3/7; sets `In-Reply-To` and `References` headers when provided; calls `service.users().messages().send(userId='me', body=...)`; returns `{id, threadId}`; implement `check_reply(service, day1_message_id: str) -> bool` — searches `in:inbox in-reply-to:{day1_message_id}`; implement `check_bounce(service, day1_message_id: str) -> bool` — searches `from:(mailer-daemon OR postmaster) in:inbox {day1_message_id}`; handle `google.auth.exceptions.RefreshError` → raise `GmailAuthExpiredError`
- [x] T015 [P] Add SQLite DB functions to `agent/agent/db_sqlite.py`: `insert_email_cadence(pool, job_id, candidate_id) -> str` (INSERT with status=`pending_discovery`, return id); `update_email_cadence(pool, cadence_id, **kwargs)` (dynamic UPDATE); `insert_email_drafts(pool, cadence_id, candidate_id, drafts: list[dict])` (batch INSERT of 3 rows); `update_email_draft(pool, draft_id, **kwargs)` (dynamic UPDATE); `get_scheduled_drafts(pool) -> list[dict]` (SELECT email_drafts JOIN email_cadences WHERE draft.status IN ('scheduled','approved') AND scheduled_send_at <= datetime('now') AND cadence.status IN ('approved','active') AND cadence.reply_detected_at IS NULL AND cadence.bounce_detected_at IS NULL ORDER BY scheduled_send_at LIMIT 10); `get_active_cadences_for_polling(pool) -> list[dict]` (SELECT WHERE status='active' AND day1_message_id IS NOT NULL); `get_daily_email_send_count(pool, candidate_id) -> int` (COUNT WHERE status='sent' AND date(sent_at)=date('now'))
- [x] T016 [P] Add PostgreSQL DB functions to `agent/agent/db_pg.py`: same 7 functions as T015 using asyncpg `$1/$2` placeholders and `pool.acquire()` context manager; use `CURRENT_DATE`, `NOW()`, `INTERVAL '72 hours'`, `FOR UPDATE SKIP LOCKED` on the scheduled drafts query
- [x] T017 Extend `src/app/api/jobs/[jobId]/approve/route.ts`: after the existing `resume_builder` and `linkedin_connector` pipeline_jobs INSERTs, add a third INSERT for `job_type='outreach_mailer'` with payload `{job_id, candidate_id, company, job_title, archetype, archetype_confidence}`; read `company`, `job_title`, `archetype`, `archetype_confidence` from the jobs SELECT already present in the handler
- [x] T018 [P] Extend `GET /api/candidates/[id]/jobs` route in `src/app/api/candidates/[id]/jobs/route.ts`: add LEFT JOIN on `email_cadences` (matching `email_cadences.job_id = jobs.id`) and LEFT JOIN on `email_drafts` (matching `email_drafts.cadence_id = email_cadences.id`); for approved jobs include `emailCadence: EmailCadenceSummary | null` with nested `drafts` array grouped by `cadence_id`; non-approved jobs return `emailCadence: null`
- [x] T019 [P] Add to `src/lib/api.ts`: `getEmailCadence(cadenceId: string, candidateId: string) -> Promise<EmailCadenceSummary>` → `GET /api/email-cadence/[cadenceId]?candidateId=`; `approveCadence(cadenceId: string, candidateId: string) -> Promise<{status: EmailCadenceStatus, approvedAt: string}>` → `POST /api/email-cadence/[cadenceId]/approve?candidateId=`; `updateDraft(cadenceId: string, draftId: string, candidateId: string, bodyHtml: string) -> Promise<EmailDraftSummary>` → `PATCH /api/email-cadence/[cadenceId]/drafts/[draftId]?candidateId=`; `overrideEmail(cadenceId: string, candidateId: string, confirmedEmail: string) -> Promise<{status: EmailCadenceStatus}>` → `POST /api/email-cadence/[cadenceId]/override-email?candidateId=`
- [x] T020 [P] Create `src/lib/email-cadence-helpers.ts`: export `EMAIL_CADENCE_STATUS_LABELS: Record<EmailCadenceStatus, string>` mapping each status to user-friendly label (e.g. `pending_approval` → `'Review & Approve'`, `active` → `'Cadence active'`, `replied` → `'Reply received'`, `cadence_complete` → `'Cadence complete'`, `bounced` → `'Day 1 bounced'`, `email_not_found` → `'Email not found'`, `low_confidence` → `'Low confidence'`, `auth_expired` → `'Gmail re-auth needed'`); export `EMAIL_CADENCE_BADGE_VARIANT: Record<EmailCadenceStatus, string>` (pending_approval → `'bg-blue-100 text-blue-800'`; active → `'bg-yellow-100 text-yellow-800'`; replied/cadence_complete → `'bg-emerald-100 text-emerald-800'`; bounced/failed → `'bg-red-100 text-red-800'`; email_not_found/cancelled → `'bg-gray-100 text-gray-500'`; auth_expired/attachment_missing → `'bg-orange-100 text-orange-800'`)
- [x] T021 Run `npx tsc --noEmit` — confirm zero TypeScript errors

**Checkpoint ✅ Foundation Ready**: Hunter.io and Gmail API clients created; all DB functions declared; approve route extended to enqueue `outreach_mailer`; GET jobs extended with `emailCadence`; frontend API client updated; TypeScript clean.

---

## Phase 3: User Story 1 — Three-Email Cadence Fires After Job Approval (Priority: P1) 🎯 MVP

**Goal**: After a job is approved, Hunter.io discovers the hiring manager's email, LiteLLM generates three email drafts (Day 1 ≤150w, Day 3 ≤100w, Day 7 ≤80w) with a self-review pass, the drafts surface for HITL candidate approval, and after approval Day 1 fires via Gmail with PDFs attached. Day 3 and Day 7 fire automatically via the daemon polling loop (every 3 minutes) once their `scheduled_send_at` elapses with no reply or bounce detected.

**Independent Test**: Approve a fixture job with a known company domain; insert a matching `pipeline_jobs` row with `job_type='outreach_mailer'`; start the Python daemon; verify `email_cadences.status = 'pending_approval'` with three `email_drafts` rows (day_number 1, 3, 7), each with non-empty body within word limits. Insert a fixture PDF in `resume_versions`; call `POST /api/email-cadence/[cadenceId]/approve`; verify Day 1 draft `status='scheduled'` then `status='sent'` after next daemon poll; verify Day 3 `scheduled_send_at = day1_sent_at + 72h`. Can be tested without real Hunter.io/Gmail using mocked DB fixtures.

> 🔵 Invoke `superpowers:test-driven-development` before T023, T026.

### 3A — Python DB Tests

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T023.

- [x] T022 [P] [US1] Write failing tests in `agent/tests/unit/test_db_email_cadence.py`: `test_insert_email_cadence_creates_pending_discovery_row`; `test_update_email_cadence_sets_status`; `test_insert_email_drafts_creates_three_rows_with_correct_day_numbers`; `test_get_daily_email_send_count_returns_zero_when_no_sends`; `test_get_daily_email_send_count_counts_todays_sends_only`; `test_get_scheduled_drafts_returns_only_elapsed_scheduled_at`; `test_get_scheduled_drafts_excludes_drafts_when_reply_detected`; `test_get_active_cadences_for_polling_returns_only_active_with_message_id` — use in-memory SQLite fixture with `email_cadences`, `email_drafts`, `candidates`, `jobs` tables
- [x] T023 [US1] Run `poetry run pytest agent/tests/unit/test_db_email_cadence.py -v` — confirm all FAIL 🔴
- [x] T024 [US1] Implement the 7 SQLite DB functions declared in T015 in `agent/agent/db_sqlite.py`; run `poetry run pytest agent/tests/unit/test_db_email_cadence.py -v` — confirm all PASS 🟢

### 3B — Outreach Mailer LangGraph Nodes

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T026.

- [x] T025 [P] [US1] Write failing tests in `agent/tests/unit/test_outreach_mailer_nodes.py` with mocked Hunter.io + LiteLLM: `test_discover_email_node_uses_finder_when_name_available_and_score_above_threshold`; `test_discover_email_node_falls_back_to_domain_search_when_finder_score_below_70`; `test_discover_email_node_sets_low_confidence_when_best_score_below_70`; `test_discover_email_node_sets_email_not_found_when_no_address_returned`; `test_generate_emails_node_produces_three_drafts_within_word_limits`; `test_generate_emails_node_rejects_day3_draft_with_forbidden_phrase_following_up`; `test_generate_emails_node_rejects_day3_draft_with_forbidden_phrase_checking_in`; `test_generate_emails_node_rejects_day7_draft_with_pressure_language`; `test_generate_emails_node_retries_on_self_review_failure` (mock first self-review call returning passes=False, second OK); `test_write_cadence_checkpoint_node_inserts_three_draft_rows_and_sets_pending_approval`
- [x] T026 [US1] Run `poetry run pytest agent/tests/unit/test_outreach_mailer_nodes.py -v` — confirm all FAIL 🔴
- [x] T027 [P] [US1] Create `agent/agent/nodes/outreach_mailer.py`: define `OutreachMailerState(TypedDict)` per data-model.md section 5; implement `discover_email_node(state, config)` — extract first_name/last_name from `state['hiring_manager_name']` if available; Pass 1: `hunter_io.find_email(domain, first_name, last_name, api_key)`; if `score >= 70` → use, set `email_source='finder'`; Pass 2: `hunter_io.domain_search(domain, api_key)`, pick highest-confidence personal entry; if `confidence >= 70` → use, set `email_source='domain_search'`; if best `confidence < 70` → `update_email_cadence(pool, id, status='low_confidence', hiring_manager_email=best_email, email_confidence=score)`, set `state.status='low_confidence'`, return; if no address → `update_email_cadence(pool, id, status='email_not_found')`, return; implement `generate_emails_node(state, config)` — build prompt from job, company, hiring_manager_name, parsed_profile archetype, enrichment signals from outreach_targets; LiteLLM call with `response_format=EmailDraftOutput` Pydantic model; `EmailDraftOutput` has `subject: str`, `day1_body: str`, `day3_body: str`, `day7_body: str`; `@field_validator` on `day1_body` enforces ≤150 words; `day3_body` enforces ≤100 words and rejects "following up"/"checking in"/"just following"/"just checking"; `day7_body` enforces ≤80 words and rejects pressure phrases ("last chance","final follow-up","urgent","time-sensitive"); implement `self_review_node(state, config)` — second LiteLLM call with `SelfReviewResult(BaseModel) { passes: bool, feedback: str }`; prompt: "Would a senior professional send these three emails to a hiring manager? Check personalisation, tone, value clarity, absence of spam signals."; if `passes=False` → append feedback to conversation, retry `generate_emails_node`; max 3 total attempts across generate+review; on 3× failure → `update_email_cadence(pool, id, status='failed')`; implement `write_cadence_checkpoint_node(state, config)` — call `insert_email_drafts(pool, cadence_id, candidate_id, [{day_number:1, subject, body_html:day1_body, body_text:..., original_body_html:day1_body}, {day_number:3,...}, {day_number:7,...}])`; `update_email_cadence(pool, id, status='pending_approval')`
- [x] T028 [US1] Run `poetry run pytest agent/tests/unit/test_outreach_mailer_nodes.py -v` — confirm all PASS 🟢

### 3C — Daemon: Cadence Send Loop

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T030.

- [x] T029 [P] [US1] Write failing tests in `agent/tests/unit/test_daemon_outreach.py`: `test_send_loop_sends_day1_when_scheduled_and_pdf_available`; `test_send_loop_sets_attachment_missing_when_no_pdf_in_resume_versions`; `test_send_loop_sets_day3_and_day7_scheduled_send_at_after_day1_sent`; `test_send_loop_skips_draft_when_cadence_reply_detected`; `test_send_loop_skips_draft_when_cadence_bounced`; `test_send_loop_sets_rate_limited_and_bumps_scheduled_at_when_20_emails_sent_today`; `test_send_loop_sets_cadence_auth_expired_on_gmail_auth_error`; `test_send_loop_threads_day3_day7_using_day1_message_id_and_thread_id` — mock `gmail_client` and DB calls
- [x] T030 [US1] Run `poetry run pytest agent/tests/unit/test_daemon_outreach.py -v` — confirm all FAIL 🔴
- [x] T031 [US1] Add `_outreach_send_loop(pool)` coroutine to `agent/agent/daemon.py`: `asyncio.sleep(180)` interval; call `get_scheduled_drafts(pool)`; for each draft: (1) check daily cap: `get_daily_email_send_count(pool, candidate_id) >= 20` → `update_email_draft(pool, draft_id, status='rate_limited', scheduled_send_at=scheduled_send_at+timedelta(days=1))`, skip; (2) for Day 1 only: query `resume_versions` for latest approved PDF for this candidate+job; if none → `update_email_cadence(pool, cadence_id, status='attachment_missing')`, skip; (3) load Gmail credentials from `candidate.preferences`; call `gmail_client.send_email(service, to=cadence.hiring_manager_email, subject=draft.subject, body_html=draft.body_html, body_text=draft.body_text, thread_id=cadence.gmail_thread_id, in_reply_to=cadence.day1_message_id, references=cadence.day1_message_id, attachments=pdfs_for_day1_else_none)`; on `GmailAuthExpiredError` → `update_email_cadence(pool, cadence_id, status='auth_expired')`, skip all remaining drafts for this cadence; (4) on success: `update_email_draft(pool, draft_id, status='sent', sent_at=now(), gmail_message_id=response['id'])`; if `day_number==1`: `update_email_cadence(pool, cadence_id, gmail_thread_id=response['threadId'], day1_message_id=draft.gmail_message_id, status='active')`; compute Day 3 `scheduled_send_at = sent_at + timedelta(hours=72)`; Day 7 `= sent_at + timedelta(hours=168)`; `update_email_draft` for Day 3 and Day 7: `status='scheduled'`, `scheduled_send_at=computed`; log every stage transition via structlog
- [x] T032 [US1] Add `outreach_mailer` job type to `agent/agent/daemon.py` dispatch dictionary: when `job_type == 'outreach_mailer'`: extract payload `{job_id, candidate_id, company, job_title, archetype}`; call `insert_email_cadence(pool, job_id, candidate_id)` to create `pending_discovery` row; query `outreach_targets` for `hiring_manager_name` if F5 has already run for this job; build `OutreachMailerState`; run `discover_email_node → generate_emails_node → self_review_node → write_cadence_checkpoint_node` in sequence via `asyncio.create_task`; handle `HunterRateLimitError` (log warning, `update_email_cadence(pool, id, status='failed', error_message=...)`)
- [x] T033 [US1] Add `_outreach_send_loop` to `asyncio.gather` in `agent/agent/daemon.py` `main()` function alongside existing job polling, snooze resurface, LinkedIn acceptance, and LinkedIn queued-send loops
- [x] T034 [US1] Run `poetry run pytest agent/tests/unit/test_daemon_outreach.py -v` — confirm all PASS 🟢

### 3D — UI: Cadence Status Display

- [x] T035 [P] [US1] Create `src/components/pipeline/EmailCadenceStatusBadge.tsx`: accepts `status: EmailCadenceStatus | null`; returns `null` if status is null, `'pending_discovery'`, `'discovering'`, or `'generating'` (transient — caller shows `Skeleton`); uses shadcn `Badge` with colour classes from `EMAIL_CADENCE_BADGE_VARIANT` in `src/lib/email-cadence-helpers.ts`; shows label from `EMAIL_CADENCE_STATUS_LABELS`; for `'pending_approval'` renders a pulsing dot to draw attention; `data-testid="email-cadence-status-badge"`
- [x] T036 [P] [US1] Extend `src/components/pipeline/JobReviewCard.tsx`: add optional `emailCadence?: EmailCadenceSummary | null` prop; when `emailCadence` is non-null and job `status === 'approved'`, render an `EmailCadenceStatusBadge` below the `OutreachNoteSelector` section (F5 component); when `emailCadence.status === 'pending_approval'` or `'active'`, also render `EmailOutreachPanel` (built in Phase 4); `data-testid="email-outreach-section"`
- [x] T037 [US1] Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T038 [US1] Run `npm run test:run` — all existing tests pass (no regressions)

**Checkpoint ✅ US1**: Approve a job via dashboard → Python daemon picks up `outreach_mailer` job → `email_cadences` row transitions `pending_discovery → discovering → generating → pending_approval` → three `email_drafts` rows created → dashboard card for that approved job shows `EmailCadenceStatusBadge` with `'pending_approval'` status and pulsing dot → after candidate approves, Day 1 draft transitions to `sent` and Day 3/7 get `scheduled_send_at` timestamps.

---

## Phase 4: User Story 2 — Candidate Reviews Email Drafts Before Sending (Priority: P2)

**Goal**: Candidate can preview all three email drafts for a job before Day 1 fires, edit any draft, and explicitly approve sending. No email fires until the candidate clicks Approve. Editing preserves the original generated version.

**Independent Test**: Insert fixture `email_cadences` row with `status='pending_approval'` and three `email_drafts` rows with status `'draft'`; open the Pipeline page; verify all three drafts are displayed with body, subject, and schedule info; PATCH Day 1 body via `PATCH /api/email-cadence/[cadenceId]/drafts/[draftId]`; verify `body_html` updated but `original_body_html` unchanged; call `POST /api/email-cadence/[cadenceId]/approve`; verify `email_cadences.status='approved'`, Day 1 draft `status='scheduled'`, Day 3 and Day 7 `status='approved'`.

> 🔵 Invoke `superpowers:test-driven-development` before T040, T050.

### 4A — API Routes

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T040.

- [x] T039 [P] [US2] Write failing tests in `src/__tests__/api/email-cadence/approve.test.ts`: `test_returns_200_with_approved_status_and_day1_scheduled`; `test_sets_day3_day7_status_to_approved`; `test_returns_409_when_already_approved`; `test_returns_422_when_cadence_not_in_pending_approval_status`; `test_sets_approved_at_timestamp`
- [x] T040 [P] [US2] Write failing tests in `src/__tests__/api/email-cadence/update-draft.test.ts`: `test_returns_200_with_updated_body_html`; `test_preserves_original_body_html_unchanged`; `test_does_not_change_draft_status`; `test_returns_409_when_draft_already_sent`; `test_returns_404_for_unknown_draft_id`; `test_returns_404_for_draft_not_in_this_cadence`
- [x] T041 [P] [US2] Write failing tests in `src/__tests__/api/email-cadence/status.test.ts`: `test_returns_200_with_cadence_and_all_three_drafts`; `test_returns_404_for_unknown_cadence`; `test_returns_403_when_candidate_id_mismatch`; `test_drafts_array_empty_until_pending_approval`
- [x] T042 [P] [US2] Write failing tests in `src/__tests__/api/email-cadence/override-email.test.ts`: `test_returns_200_and_sets_status_to_generating`; `test_sets_email_source_to_manual_override`; `test_inserts_outreach_mailer_generate_pipeline_job`; `test_returns_422_when_cadence_not_in_low_confidence_status`
- [x] T043 [US2] Run `npm run test:run` — confirm all new email-cadence API tests FAIL 🔴
- [x] T044 [US2] Create `src/app/api/email-cadence/[cadenceId]/approve/route.ts`: `POST` handler; `await params`; read `candidateId` from query; load cadence; verify `status === 'pending_approval'` → 422 otherwise; conditional UPDATE `email_cadences SET status='approved', approved_at=now() WHERE id=? AND status='pending_approval'` → 409 if 0 rows affected; UPDATE `email_drafts SET is_approved=true, status='scheduled', scheduled_send_at=now() WHERE cadence_id=? AND day_number=1`; UPDATE `email_drafts SET is_approved=true, status='approved' WHERE cadence_id=? AND day_number IN (3,7)`; return `{ cadenceId, status:'approved', approvedAt, drafts:[{draftId, dayNumber, status, scheduledSendAt},...] }`
- [x] T045 [P] [US2] Create `src/app/api/email-cadence/[cadenceId]/drafts/[draftId]/route.ts`: `PATCH` handler; `await params`; read `bodyHtml` from request body; load draft; if `draft.status IN ('sent','sending','cancelled','bounced')` → 409; UPDATE `email_drafts SET body_html=?, updated_at=now() WHERE id=? AND cadence_id=?` (note: `original_body_html` is never overwritten); return `{ draftId, dayNumber, bodyHtml, originalBodyHtml, status }`
- [x] T046 [P] [US2] Create `src/app/api/email-cadence/[cadenceId]/route.ts`: `GET` handler; `await params`; read `candidateId` from query; SELECT `email_cadences` + `email_drafts` WHERE `email_cadences.id=? AND email_cadences.candidate_id=?`; 404 if cadence not found; 403 if candidate mismatch; return full `EmailCadenceSummary` with `drafts` array sorted by `day_number`
- [x] T047 [P] [US2] Create `src/app/api/email-cadence/[cadenceId]/override-email/route.ts`: `POST` handler; `await params`; read `{ confirmedEmail }` from body; verify `cadence.status === 'low_confidence'` → 422 otherwise; UPDATE `email_cadences SET hiring_manager_email=?, email_source='manual_override', status='generating', updated_at=now()`; INSERT `pipeline_jobs (job_type='outreach_mailer_generate', candidate_id, payload={cadence_id, job_id, candidate_id})` to re-trigger generation; return `{ cadenceId, status:'generating', hiringManagerEmail:confirmedEmail, emailSource:'manual_override' }`
- [x] T048 [US2] Run `npm run test:run` — confirm all new email-cadence API tests PASS 🟢

### 4B — EmailOutreachPanel UI Component

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T050.

- [x] T049 [P] [US2] Write failing component tests in `src/__tests__/components/pipeline/EmailOutreachPanel.test.tsx`: `test_renders_three_draft_cards_when_status_pending_approval`; `test_approve_button_present_when_pending_approval`; `test_clicking_approve_calls_approveCadence_and_updates_status`; `test_shows_low_confidence_notice_with_override_button`; `test_override_button_calls_overrideEmail`; `test_shows_replied_banner_when_status_replied`; `test_shows_bounce_cancelled_banner_when_status_bounced`; `test_shows_auth_expired_warning_when_status_auth_expired`; `test_shows_attachment_missing_notice_when_status_attachment_missing`
- [x] T050 [P] [US2] Write failing component tests in `src/__tests__/components/pipeline/EmailDraftCard.test.tsx`: `test_renders_day_label_subject_and_body`; `test_edit_button_opens_textarea_with_current_body`; `test_save_calls_updateDraft_with_edited_body`; `test_original_toggle_shows_original_body_html`; `test_shows_sent_at_when_draft_sent`; `test_shows_open_detected_badge_when_open_detected`
- [x] T051 [US2] Run `npm run test:run` — confirm all new component tests FAIL 🔴
- [x] T052 [P] [US2] Create `src/components/pipeline/EmailDraftCard.tsx`: `'use client'`; accepts `draft: EmailDraftSummary`, `cadenceId: string`, `candidateId: string`, `onDraftUpdated: (d: EmailDraftSummary) => void`; renders shadcn `Card` with header showing `Day {dayNumber}` label (Day 1 / Day 3 / Day 7) and `subject`; body preview in a `<div>` with `dangerouslySetInnerHTML` sandboxed; "Show Original" toggle button that swaps to `originalBodyHtml` (greyed out, read-only); Edit shadcn `Button` that toggles a `Textarea` pre-filled with current `bodyHtml`; Save button that calls `updateDraft(cadenceId, draftId, candidateId, editedBody)` → `onDraftUpdated(result)`; shows `Skeleton` during save; shows `sentAt`, `openDetectedAt`, `clickDetectedAt`, `status` as shadcn `Badge` per draft status using `EMAIL_DRAFT_STATUS_LABELS`; `data-testid="email-draft-card-day-{dayNumber}"`, `data-testid="draft-edit-btn"`, `data-testid="draft-save-btn"`, `data-testid="draft-edit-textarea"`, `data-testid="draft-original-toggle"`, `data-testid="draft-open-badge"`, `data-testid="draft-status-badge"`
- [x] T053 [US2] Create `src/components/pipeline/EmailOutreachPanel.tsx`: `'use client'`; accepts `cadence: EmailCadenceSummary`, `candidateId: string`, `onCadenceUpdated: (c: EmailCadenceSummary) => void`; renders section header "Email Outreach"; when `status === 'pending_approval'`: renders three `EmailDraftCard` components + "Approve & Send" shadcn `Button` (calls `approveCadence(cadenceId, candidateId)` → `onCadenceUpdated(result)`; shows `Spinner` during request); when `status === 'low_confidence'`: renders email address + confidence `Badge` + "Send Anyway" `Button` (calls `overrideEmail(...)`); when `status === 'email_not_found'`: renders muted "Email not found" notice; when `status === 'active'`: renders all three `EmailDraftCard` components in read/tracking mode; when `status === 'replied'`: renders green shadcn `Alert` "Reply received — cadence paused"; when `status === 'bounced'`: renders red `Alert` "Day 1 bounced — cadence cancelled"; when `status === 'cadence_complete'`: renders muted notice "Cadence complete — no reply received"; when `status === 'auth_expired'`: renders orange `Alert` "Re-authorise Gmail to resume"; when `status === 'attachment_missing'`: renders muted notice with `Spinner` "Awaiting resume PDF"; `data-testid="email-outreach-panel"`, `data-testid="approve-cadence-btn"`, `data-testid="override-email-btn"`, `data-testid="low-confidence-notice"`, `data-testid="reply-received-banner"`, `data-testid="bounce-cancelled-banner"`, `data-testid="auth-expired-banner"`, `data-testid="attachment-missing-notice"`
- [x] T054 [US2] Run `npm run test:run` — confirm all component tests PASS 🟢

### 4C — Integration

- [x] T055 [US2] Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T056 [US2] Run `npm run test:run` — all tests pass, no regressions

**Checkpoint ✅ US2**: Insert fixture `email_cadences` with `status='pending_approval'` and three draft rows; open Pipeline page; approved job card shows `EmailOutreachPanel` with three `EmailDraftCard` components; edit Day 1 body → verify `original_body_html` unchanged in DB; click "Approve & Send" → verify `email_cadences.status='approved'`, Day 1 `status='scheduled'`; badge transitions to reflect pending send.

---

## Phase 5: User Story 3 — Email Tracking and Dashboard Visibility (Priority: P3)

**Goal**: The candidate sees send/open/reply/bounce status of every email in the cadence from their dashboard. Open and click tracking update from email interactions. Reply and bounce detection run automatically via the daemon polling loop every hour.

**Independent Test**: Insert a fixture `email_drafts` row with `status='sent'` and a `day1_message_id` in the parent cadence; call `GET /api/track/open/[draftId]` in a browser; verify response is a 1×1 GIF and `email_drafts.open_detected_at` is set in DB; call again — verify `open_detected_at` is not overwritten (idempotent); simulate Gmail reply in daemon test mock; verify `email_cadences.status='replied'` and pending Day 3/7 drafts `status='cancelled'`.

> 🔵 Invoke `superpowers:test-driven-development` before T059, T064.

### 5A — Tracking Endpoints

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T059.

- [x] T057 [P] [US3] Write failing tests in `src/__tests__/api/track/open.test.ts`: `test_returns_1x1_gif_with_correct_content_type`; `test_sets_open_detected_at_on_first_call`; `test_is_idempotent_does_not_overwrite_first_open_detected_at`; `test_returns_gif_even_for_unknown_draft_id` (silent fail — never reveal tracking pixel existence)
- [x] T058 [P] [US3] Write failing tests in `src/__tests__/api/track/click.test.ts`: `test_returns_301_redirect_to_decoded_url`; `test_sets_click_detected_at_on_first_call`; `test_is_idempotent_on_subsequent_clicks`; `test_returns_400_when_url_param_missing`
- [x] T059 [US3] Run `npm run test:run` — confirm all tracking tests FAIL 🔴
- [x] T060 [US3] Create `src/app/api/track/open/[draftId]/route.ts`: `GET` handler; no auth required; `await params`; load draft by id (silent if not found); if found and `open_detected_at IS NULL` → UPDATE `email_drafts SET open_detected_at=now()`; return `Response` with 1×1 transparent GIF bytes, `Content-Type: image/gif`, `Cache-Control: no-store, no-cache`
- [x] T061 [P] [US3] Create `src/app/api/track/click/[draftId]/route.ts`: `GET` handler; `await params`; read `url` from `searchParams`; if `url` missing → 400; load draft by id; if found and `click_detected_at IS NULL` → UPDATE `email_drafts SET click_detected_at=now()`; return `Response.redirect(decodedUrl, 301)`
- [x] T062 [US3] Run `npm run test:run` — confirm all tracking tests PASS 🟢

### 5B — Reply + Bounce Detection Daemon

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T064.

- [x] T063 [P] [US3] Append failing tests to `agent/tests/unit/test_daemon_outreach.py`: `test_reply_detection_sets_cadence_replied_and_cancels_pending_drafts`; `test_reply_detection_skips_when_no_day1_message_id`; `test_bounce_detection_sets_cadence_bounced_sets_day1_bounced_and_cancels_day3_day7`; `test_detection_loop_handles_gmail_auth_expired_gracefully`; `test_detection_loop_does_not_overwrite_existing_reply_detected_at` — mock `gmail_client.check_reply` and `gmail_client.check_bounce`
- [x] T064 [US3] Run `poetry run pytest agent/tests/unit/test_daemon_outreach.py -k "reply_detection or bounce_detection" -v` — confirm all FAIL 🔴
- [x] T065 [US3] Add `_reply_bounce_detection_loop(pool)` coroutine to `agent/agent/daemon.py`: `asyncio.sleep(3600)` interval; call `get_active_cadences_for_polling(pool)`; for each cadence: load `candidate.preferences.gmail_access_token` and `gmail_refresh_token`; `gmail_client.build_service(access_token, refresh_token)`; call `gmail_client.check_reply(service, cadence.day1_message_id)` → if True: `update_email_cadence(pool, id, status='replied', reply_detected_at=now())`; UPDATE `email_drafts SET status='cancelled' WHERE cadence_id=? AND status IN ('scheduled','approved')`; log event; `continue` to next cadence; call `gmail_client.check_bounce(service, cadence.day1_message_id)` → if True: `update_email_cadence(pool, id, status='bounced', bounce_detected_at=now())`; UPDATE `email_drafts SET status='bounced' WHERE day_number=1`; UPDATE `email_drafts SET status='cancelled' WHERE day_number IN (3,7)`; log event; catch `GmailAuthExpiredError` → `update_email_cadence(pool, id, status='auth_expired')`; catch all other exceptions → log warning and continue (one failing cadence must not halt the loop)
- [x] T066 [US3] Add `_reply_bounce_detection_loop` to `asyncio.gather` in `agent/agent/daemon.py` `main()`
- [x] T067 [US3] Run `poetry run pytest agent/tests/unit/test_daemon_outreach.py -v` — all tests PASS 🟢

### 5C — Tracking Status in Dashboard

- [x] T068 [P] [US3] Verify `EmailDraftCard.tsx` (T052) shows `openDetectedAt` and `clickDetectedAt` badges — add `data-testid="draft-click-badge"` if missing; confirm tracking pixel `<img>` tag is embedded in `bodyHtml` by the Python generation node (`agent/agent/nodes/outreach_mailer.py`: append `<img src="{TRACKING_HOST}/api/track/open/{draft_id}" width="1" height="1">` to each draft's body_html before inserting; read `TRACKING_HOST` from env var)
- [x] T069 [P] [US3] Add `TRACKING_HOST` env var to `agent/.env.example` and `agent/agent/config.py`; document in `quickstart.md` under "Dev Workflow" section
- [x] T070 [US3] Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T071 [US3] Run `npm run test:run` — all tests pass

**Checkpoint ✅ US3**: Day 1 email sent with tracking pixel; call `GET /api/track/open/[draftId]` in browser; verify `open_detected_at` set in DB; `EmailDraftCard` shows "Opened" badge; simulate reply in daemon test; verify `email_cadences.status='replied'` and Day 3/7 drafts `status='cancelled'`.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Observability, `outreach_mailer_generate` re-run job type, PostgreSQL functions, final verification.

> 🔵 Invoke `superpowers:verification-before-completion` at T081 before final commit.

- [x] T072 [P] Add structlog logging to `agent/agent/nodes/outreach_mailer.py`: log each Hunter.io call with `domain`, `email_found`, `confidence`, `source`; log generation attempt number and word counts for each draft; log self-review result with `passes`, `feedback` excerpt; log each status transition at INFO; log rate-limit events at WARNING
- [x] T073 [P] Add `outreach_mailer_generate` job type handler to `agent/agent/daemon.py`: when `job_type == 'outreach_mailer_generate'`: fetch existing cadence by `cadence_id` from payload; skip discovery; re-run `generate_emails_node → self_review_node → write_cadence_checkpoint_node` only; on success → `status='pending_approval'`; on 3× failure → `status='failed'`
- [x] T074 [P] Implement all 7 PostgreSQL DB functions in `agent/agent/db_pg.py` (T016 declaration); verify asyncpg-specific SQL: `$1/$2` params; `CURRENT_DATE`; `NOW()`; `INTERVAL '72 hours'`; `FOR UPDATE SKIP LOCKED` on scheduled drafts query; `pool.acquire()` context manager pattern
- [x] T075 [P] Add `data-testid="email-outreach-section"` wrapper to the email cadence section within `src/components/pipeline/JobReviewCard.tsx` if not already present from T036
- [x] T076 Run full Next.js test suite: `npm run test:run` — all tests pass
- [x] T077 Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T078 Run `npm run build` — exits 0, no prerender errors
- [x] T079 Run full Python test suite: `cd agent && poetry run pytest tests/unit/ -v` — all tests pass
- [x] T080 🔵 **Invoke `superpowers:verification-before-completion`** — run `npm run test:run`, `npx tsc --noEmit`, `npm run build`; all must pass with evidence before proceeding
- [x] T081 Manual smoke test per `quickstart.md` Scenario 1: start daemon + `npm run dev`; approve a job via dashboard; watch daemon logs for `pending_discovery → discovering → generating → pending_approval`; open Pipeline page; verify three draft cards shown; click "Approve & Send"; verify `email_cadences.status='approved'`, Day 1 draft `status='scheduled'` then `status='sent'` after 3-minute daemon poll; verify `Day 3 scheduled_send_at = Day1 sent_at + 72h`
- [x] T082 Manual smoke test per `quickstart.md` Scenario 2: set Hunter.io mock to return low-confidence result; approve a job; verify `email_cadences.status='low_confidence'` and low-confidence notice on dashboard; click "Send Anyway"; verify generation resumes and drafts appear
- [x] T083 Manual smoke test per `quickstart.md` Scenario 5 (Bounce): after Day 1 sent, simulate bounce in DB; verify `email_cadences.status='bounced'`, Day 3/7 `status='cancelled'`, bounce banner on dashboard
- [x] T084 Final commit: `git add -A && git commit -m "feat: outreach mailer agent — F6 complete"`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup — DB schema, migrations, TS types)
    └─► Phase 2 (Foundational — Python API clients, DB functions, approve route, GET jobs extension)
              └─► Phase 3 (US1 — Hunter.io discovery, LiteLLM generation, daemon send loop, status badge) 🎯 MVP
                        └─► Phase 4 (US2 — HITL review UI, draft edit/approve routes, EmailOutreachPanel)
                                  └─► Phase 5 (US3 — open/click tracking endpoints, reply/bounce detection)
                                            └─► Phase 6 (Polish)
```

### User Story Dependencies

- **US1 (P1)**: Requires Phases 1–2 complete. Delivers the full Python pipeline: Hunter.io discovery → LiteLLM generation + self-review → `pending_approval` status → daemon send loop fires Day 1 with PDFs → Day 3/7 scheduled. Dashboard shows `EmailCadenceStatusBadge` on approved job cards.
- **US2 (P2)**: Requires US1 complete (cadence must reach `pending_approval` with drafts in DB). Delivers the HITL review path: candidate sees draft cards, edits, approves. Approval triggers the US1 daemon send loop.
- **US3 (P3)**: Requires US1 complete (Day 1 must be sent with tracking pixel embedded). Delivers open/click tracking endpoints and reply/bounce detection daemon loop. Dashboard updates with tracking badges.

### Within Each Phase

- DB migration (T009–T011) MUST complete before any Python or Next.js code reads/writes `email_cadences` or `email_drafts`
- Python API clients (T013–T014) MUST complete before any LangGraph node uses them
- Approve route extension (T017) MUST complete before daemon can be tested end-to-end
- Test writing MUST complete and tests MUST **FAIL** before implementation begins (TDD gates)
- TypeScript check after each phase before moving to next

### Parallel Opportunities

**Within Phase 2** (all different files):
- T013 (`hunter_io.py`) + T014 (`gmail_client.py`) + T015 (SQLite DB funcs) + T016 (PG DB funcs) + T018 (GET jobs extension) + T019 (API client) + T020 (email-cadence-helpers) — all parallel

**Within Phase 3**:
- T022 (DB tests) + T025 (node tests) + T029 (send loop tests) + T035 (EmailCadenceStatusBadge) — all parallel (different files)
- T027 (all 4 LangGraph nodes) + T031 (daemon send loop) — parallel (different scopes)
- T032 (daemon dispatch) depends on T027 and T031

**Within Phase 4**:
- T039 + T040 + T041 + T042 (all API tests) + T049 + T050 (component tests) — all parallel (different files)
- T044 + T045 + T046 + T047 (all route implementations) + T052 + T053 (UI components) — all parallel
- T054 depends on T052 + T053

**Within Phase 5**:
- T057 + T058 (tracking tests) + T063 (detection tests) — parallel
- T060 + T061 (tracking routes) parallel; T065 (detection daemon) independent
- T068 + T069 (tracking display) parallel

**Polish phase**: T072, T073, T074, T075 — all parallel (different files)

---

## Parallel Example: Phase 3 (US1)

```bash
# Parallel batch 1 — write all failing tests simultaneously:
Task T022: agent/tests/unit/test_db_email_cadence.py
Task T025: agent/tests/unit/test_outreach_mailer_nodes.py
Task T029: agent/tests/unit/test_daemon_outreach.py
Task T035: src/components/pipeline/EmailCadenceStatusBadge.tsx

# Parallel batch 2 — after tests confirmed failing, implement simultaneously:
Task T024: agent/agent/db_sqlite.py  (7 DB functions)
Task T027: agent/agent/nodes/outreach_mailer.py  (4 nodes)
Task T031: agent/agent/daemon.py  (_outreach_send_loop)

# Sequential after batch 2:
Task T032: agent/agent/daemon.py  (dispatch + asyncio.gather)  ← depends on T027 + T031
Task T036: src/components/pipeline/JobReviewCard.tsx           ← depends on T035
```

## Parallel Example: Phase 4 (US2)

```bash
# Parallel batch 1 — write all failing tests simultaneously:
Task T039: src/__tests__/api/email-cadence/approve.test.ts
Task T040: src/__tests__/api/email-cadence/update-draft.test.ts
Task T041: src/__tests__/api/email-cadence/status.test.ts
Task T042: src/__tests__/api/email-cadence/override-email.test.ts
Task T049: src/__tests__/components/pipeline/EmailOutreachPanel.test.tsx
Task T050: src/__tests__/components/pipeline/EmailDraftCard.test.tsx

# Parallel batch 2 — implement simultaneously:
Task T044: src/app/api/email-cadence/[cadenceId]/approve/route.ts
Task T045: src/app/api/email-cadence/[cadenceId]/drafts/[draftId]/route.ts
Task T046: src/app/api/email-cadence/[cadenceId]/route.ts
Task T047: src/app/api/email-cadence/[cadenceId]/override-email/route.ts
Task T052: src/components/pipeline/EmailDraftCard.tsx

# Sequential after batch 2:
Task T053: src/components/pipeline/EmailOutreachPanel.tsx  ← depends on T052
```

---

## Implementation Strategy

### MVP First (US1 Only — ~3 days)

1. Complete Phase 1 (Schema + migrations — ~2 hours)
2. Complete Phase 2 (Foundation — API clients, DB functions, approve extension — ~3 hours)
3. Complete Phase 3 (US1 — Python pipeline + daemon send loop + status badge — ~2 days)
4. **STOP and VALIDATE**: Approve a job; verify `email_cadences.status='pending_approval'` with 3 draft rows; verify Day 1 sends after manual DB approval; verify Day 3 `scheduled_send_at` computed
5. MVP delivered: automatic hiring manager email discovery + 3-draft generation + Day 1 send + Day 3/7 scheduling

### Incremental Delivery

1. Phases 1–3 → US1 MVP: Python pipeline + daemon working end-to-end
2. Phase 4 → US2: HITL review UI — candidate previews, edits, approves (full compliance with spec HITL gate)
3. Phase 5 → US3: Open/click tracking + reply/bounce detection (full cadence observability)
4. Phase 6 → Production-hardened: logging, PostgreSQL functions, fully verified

### Parallel Team Strategy

Once Phase 2 is complete:
- **Developer A**: Phase 3 Python nodes (discover, generate, self-review, write-checkpoint) + daemon send loop
- **Developer B**: Phase 4 Next.js API routes (approve, PATCH draft, GET cadence, override-email)
- **Developer C**: Phase 4 UI components (EmailDraftCard, EmailOutreachPanel) + Phase 5 tracking endpoints

---

## Task Tracker Summary

| Phase | Tasks | Completed | Status |
|---|---|---|---|
| Phase 1: Setup (Schema + Migrations) | T001–T012 | 12/12 | ✅ Complete |
| Phase 2: Foundational | T013–T021 | 9/9 | ✅ Complete |
| Phase 3: US1 (Discovery + Generation + Send Loop) | T022–T038 | 17/17 | ✅ Complete |
| Phase 4: US2 (HITL Review UI + Approve Routes) | T039–T056 | 18/18 | ✅ Complete |
| Phase 5: US3 (Tracking + Reply/Bounce Detection) | T057–T071 | 15/15 | ✅ Complete |
| Phase 6: Polish | T072–T084 | 13/13 | ✅ Complete |
| **Total** | **T001–T084** | **84/84** | **100% complete** |

---

## Superpowers Skill Gate Summary

| Gate | When | Task ref |
|---|---|---|
| `superpowers:test-driven-development` | Before T023 (Python DB email cadence tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T026 (outreach mailer node tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T030 (daemon send loop tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T040 (email-cadence API route tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T050 (EmailOutreachPanel component tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T059 (tracking endpoint tests) | Phase 5 |
| `superpowers:test-driven-development` | Before T064 (reply/bounce detection tests) | Phase 5 |
| `superpowers:systematic-debugging` | On any test failure or unexpected behaviour | Any phase |
| `superpowers:dispatching-parallel-agents` | T022+T025+T029+T035 in parallel (Phase 3); T039+T040+T041+T042+T049+T050 in parallel (Phase 4); T057+T058+T063 in parallel (Phase 5) | Phases 3–5 |
| `superpowers:verification-before-completion` | Before T082 (smoke test + final commit) | Phase 6 |
