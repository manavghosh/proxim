# Research: HITL Review Dashboard (F4) — Phase 0

**Branch**: `004-hitl-review-dashboard` | **Date**: 2026-05-04

---

## Decision 1: HITL Checkpointing Strategy

**Decision**: Custom `hitl_checkpoints` table — NOT LangGraph's built-in `SqliteSaver`/`AsyncPostgresSaver`

**Rationale**:
LangGraph's built-in checkpointer is designed for resumable graph execution: it snapshots full graph state at every node to allow mid-graph interruption and restart from any point. This feature does NOT need graph resumption — when a candidate approves/rejects/snoozes a job, the decision updates the job's status in the DB, and downstream agents (resume builder) pick up from that DB state on their next poll. No graph needs to be "resumed" from a paused state.

The custom `hitl_checkpoints` table gives:
- Full auditability: every decision with timestamps and decision type
- Crash recovery: `awaiting` jobs survive service restarts — the dashboard simply reads `jobs WHERE status = 'awaiting'`
- Zero overhead: no full graph state serialisation per node
- Simplicity: one INSERT per decision, one SELECT for the review queue

**Alternatives considered**:
- **LangGraph `SqliteSaver`**: Rejected — serialises entire graph state (all LangGraph channels) at every node. Overkill for a simple gate that only needs to record a decision.
- **In-memory state only**: Rejected — fails FR-011 (pipeline state MUST survive service restart).

---

## Decision 2: Real-Time Job Arrival — SSE Strategy

**Decision**: New candidate-scoped SSE endpoint `/api/candidates/[id]/jobs/stream`, 5-second polling, EventSource with auto-reconnect

**Rationale**:
The existing `GET /api/pipeline/[jobId]/stream` is scoped to a specific pipeline job run. New scored jobs can arrive from any pipeline run. A candidate-scoped stream solves this by polling `jobs WHERE candidate_id = ? AND status NOT IN ('discovered', 'score_failed') AND created_at > lastSeen`. 5-second polling (not 2s) reduces DB load while still meeting the ≤5s SC-004 requirement (worst case: a job written at T=0 appears at T=5).

Auto-reconnect: The browser's native `EventSource` API reconnects automatically after a disconnect. A 60-second idle timeout closes the stream gracefully after no new jobs arrive; the client reconnects after 3 seconds.

**SSE event schema**:
```json
{ "event": "jobs_arrived", "data": { "count": 3, "jobIds": ["uuid1", "uuid2", "uuid3"] } }
{ "event": "snooze_expired", "data": { "jobId": "uuid", "title": "VP of AI", "company": "Acme" } }
{ "event": "idle", "data": {} }
```

**Alternatives considered**:
- **WebSockets**: Rejected — more infrastructure complexity (persistent connection server required), not idiomatic for Next.js App Router. EventSource + SSE is simpler and sufficient for one-way server → client notifications.
- **Client polling (`setInterval`)**: Rejected — would require explicit polling code on every page; SSE gives a cleaner abstraction and respects HTTP/2 multiplexing.
- **2-second polling**: Rejected — 30 DB queries/minute per connected user. 5s is 12 queries/minute, still meets SC-004.

---

## Decision 3: Snooze Auto-Resurface

**Decision**: Python daemon polls `hitl_checkpoints WHERE status='snoozed' AND snooze_until <= now()` every 60 seconds; resets job to `awaiting`

**Rationale**:
The spec states "7-day snooze re-surfacing is managed by a scheduled check in the Python polling daemon." The existing daemon already has a 3-second main poll loop. A secondary 60-second loop (using `asyncio.sleep(60)` in a separate coroutine) checks for expired snoozes without interfering with the main pipeline job claiming. On expiry: update `jobs.status = 'awaiting'`, `hitl_checkpoints.status = 'awaiting'`, clear `snoozed_until`. The SSE stream will then surface the job on the next 5-second poll.

**Alternatives considered**:
- **Next.js cron job**: Rejected — spec explicitly states Python daemon handles this. Also, Next.js has no reliable cron mechanism without an external service.
- **Database trigger**: Rejected — not portable between SQLite (dev) and Neon (prod); adds DB complexity.

---

## Decision 4: Concurrent Approval Safety

**Decision**: Optimistic locking — UPDATE jobs SET status='approved' WHERE id=? AND status='awaiting' + check affected rows

**Rationale**:
Rather than `SELECT FOR UPDATE` (which requires a transaction and asyncpg/aiosqlite awareness), the Next.js route uses a conditional UPDATE: `UPDATE jobs SET status='approved' WHERE id=? AND status='awaiting'`. If 0 rows are affected, the job was already processed by another request — return 409 with "already decided". This is atomic in both SQLite and PostgreSQL. No row-level locking complexity needed.

**Alternatives considered**:
- **`SELECT FOR UPDATE SKIP LOCKED`**: Rejected — requires explicit transaction management in Drizzle. The conditional UPDATE achieves the same safety with less code.
- **Application-level mutex**: Rejected — doesn't work across multiple Next.js instances (e.g., production with multiple replicas).

---

## Decision 5: Grade Filter Persistence

**Decision**: Store active filter in `candidates.preferences` JSONB — key `hitl_grade_filter`: `'A' | 'A+B' | 'all'`

**Rationale**:
Consistent with the existing pattern where `grade_filter` is stored in preferences for the Applications page. The Pipeline page uses a separate key `hitl_grade_filter` so the two filters are independent. Default: `'A+B'` (surfaces best matches first). The filter is saved via `PUT /api/preferences` on change, just like other preference fields.

---

## Decision 6: Score Report Rendering

**Decision**: Inline collapsible markdown rendered via `ReactMarkdown` or native Tailwind prose — NO modal, NO page navigation

**Rationale**:
FR-003 mandates inline rendering. The existing `ReportDrawer` (Sheet component) violates this — it overlays the page. The new `ScoreReportPane` is a collapsible section below the job card header, toggled by a "View Report ↓" button. When expanded, it renders the `report_md` field (already stored in `jobs` table from F9) as markdown using the existing Tailwind prose styles. The `ReportDrawer` component continues to be used on the Applications page; the Pipeline page uses the new inline pattern.

---

## Decision 7: Strength/Risk Chips Source

**Decision**: Extract top-3 strengths and top-2 risks from the `score10d` JSONB field at render time — no additional LLM call

**Rationale**:
The `score10d` field (already in `jobs` table) contains reasoning for all 10 dimensions. Strengths = top-3 dimensions by score. Risks = bottom-2 weighted dimensions by score. Both can be derived with a simple sort on the client — no API call needed. Displayed as coloured chips on the card without expansion.
