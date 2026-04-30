# Feature Specification: HITL Review Dashboard (F4)

**Feature Branch**: `004-hitl-review-dashboard`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 3 — Human Loop

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Review and Approve a Scored Job (Priority: P1)

The candidate opens the Pipeline page and sees their scored jobs with grade badges. They read the score report for a B+ job, decide it's a strong fit, and click Approve. Resume generation begins immediately.

**Why this priority**: The HITL approval gate is the central trust mechanism of the product — nothing outbound fires without this step. Every other pipeline feature depends on it.

**Independent Test**: Can be tested by inserting a fixture scored job, loading the review page, and verifying the approve action updates the job status and triggers the resume generation job queue entry.

**Acceptance Scenarios**:

1. **Given** scored jobs exist, **When** the candidate loads the Pipeline page, **Then** each job displays: grade badge (A–F colour-coded), numeric score, company name, role title, source, and posted date.
2. **Given** a B+ job card is visible, **When** the candidate clicks to expand, **Then** the full 6-block score report renders inline as markdown (no modal, no page navigation).
3. **Given** the candidate clicks Approve on a job, **When** the action is confirmed, **Then** the job status updates to `approved` and a resume generation entry is queued immediately.
4. **Given** the candidate clicks Reject, **When** confirmed, **Then** the job is marked `rejected` and permanently removed from all future dashboard views.
5. **Given** the candidate clicks Snooze, **When** confirmed, **Then** the job is hidden and re-appears automatically after 7 days.

---

### User Story 2 — Pipeline State Persists Across Restarts (Priority: P2)

The pipeline pauses at the HITL gate using a LangGraph checkpoint. If the server restarts while jobs are awaiting review, the pipeline resumes exactly where it left off when the server comes back up.

**Why this priority**: An enterprise candidate may take hours or days to review a batch. Pipeline state must survive infrastructure events without data loss.

**Independent Test**: Can be tested by creating a HITL checkpoint, restarting the Python agent service, and verifying the awaiting job reappears on the dashboard unchanged.

**Acceptance Scenarios**:

1. **Given** jobs are awaiting HITL review and the Python agent service restarts, **When** the service comes back up, **Then** all `awaiting` HITL checkpoints are still visible on the dashboard and resume correctly on next action.
2. **Given** two candidates approve jobs simultaneously, **When** both actions land on the server, **Then** each approval is processed independently with no race condition or data corruption.

---

### User Story 3 — Real-Time Job Arrival Notification (Priority: P3)

When the scoring pipeline finishes processing a batch, newly scored jobs appear on the candidate's dashboard without a page refresh.

**Why this priority**: A senior candidate checking in periodically needs to know immediately when new opportunities have landed without manual polling.

**Independent Test**: Can be tested by triggering a scoring run, then verifying a new job card appears on the open dashboard within 5 seconds of the score being written.

**Acceptance Scenarios**:

1. **Given** the candidate has the Pipeline page open, **When** a new scored job is written to the database, **Then** a job card appears within 5 seconds without a page refresh.
2. **Given** the connection drops temporarily, **When** reconnected, **Then** the dashboard catches up and displays any jobs that arrived during the disconnection.

---

### Edge Cases

- What if a candidate approves a job and the resume generation queue write fails? → The approval is rolled back atomically; the job returns to `awaiting` status and the candidate sees an error message with a retry option.
- What if the score report markdown contains rendering issues? → The report is displayed as plain text fallback if markdown rendering fails, preserving all content.
- What if the same job is approved in two browser tabs simultaneously? → Row-level locking on the job record prevents double-processing; the second approval receives a "already approved" response.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each job card on the Pipeline page MUST display: letter grade (colour-coded), numeric score, company, role title, source, and posted date — visible without expanding.
- **FR-002**: Top 3 score strengths and top 2 risks MUST be visible as chips on the job card without expansion.
- **FR-003**: The full 6-block score report MUST be viewable via one interaction — rendered inline as markdown, no modal window, no page navigation.
- **FR-004**: F-grade jobs MUST NEVER appear on the dashboard under any filter setting.
- **FR-005**: The dashboard MUST support three grade filter modes: "A only", "A+B", "All (C/D/F excluded)". The active filter MUST persist in user preferences across sessions.
- **FR-006**: Jobs MUST be sortable by: score (default), posted date, company name.
- **FR-007**: Each job MUST support three actions: Approve, Reject, Snooze (7 days).
- **FR-008**: Approve MUST enqueue a resume generation job (`pipeline_jobs` row) and update the job status to `approved` atomically.
- **FR-009**: Reject MUST permanently mark the job as `rejected`; rejected jobs MUST NEVER resurface in any dashboard view or future run.
- **FR-010**: Snooze MUST hide the job and make it re-appear automatically after 7 days without any candidate action.
- **FR-011**: HITL pipeline state MUST be checkpointed to the database before the pipeline pauses. A service restart MUST NOT lose pending approvals.
- **FR-012**: Concurrent approvals MUST be handled safely — row-level locking MUST prevent two actions from processing the same job simultaneously.
- **FR-013**: New scored jobs MUST appear on the dashboard within 5 seconds of being written, via server-sent events (no page refresh required).
- **FR-014**: The SSE connection MUST reconnect automatically after a disconnect and catch up on any missed events.

### Key Entities

- **HITL Checkpoint** (`hitl_checkpoints`): A record of a pipeline pause point. Contains `status` (`awaiting` → `approved` | `rejected` | `snoozed`), `decision`, `job_id`, `payload`, and `decided_at`.
- **Job** (`jobs`): Extended with `status` field covering `discovered → scored → awaiting → approved | rejected | snoozed`.
- **Snooze Record**: Part of HITL checkpoint — stores the snooze-until timestamp for auto-resurface logic.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: HITL decision time (approve / reject / snooze) ≤ 60 seconds per job when the candidate has read the report.
- **SC-002**: Pipeline state survives service restart with 100% checkpoint recovery — zero lost pending approvals.
- **SC-003**: Grade badge renders within 200ms of page load (data pre-loaded with job list).
- **SC-004**: New job cards appear on the open dashboard within 5 seconds of a score being written.
- **SC-005**: Zero concurrent approval race conditions across 1,000 simulated simultaneous approvals.

## Assumptions

- F9 (10D Scoring Engine) is complete — jobs in the database have populated `grade`, `score_10d`, and `report_md` fields before this feature displays them.
- F10 (Resume Builder Agent) is complete or running in parallel — the Approve action triggers resume generation via the Neon job queue, not a direct function call.
- The SSE stream reads the `pipeline_runs` and `hitl_checkpoints` tables via the Next.js Route Handler polling Neon every 2 seconds (per Constitution §VII).
- The 7-day snooze re-surfacing is managed by a scheduled check in the Python polling daemon — not a Next.js cron.
- The Pipeline page (`/pipeline`) replaces the current placeholder page built in Phase 1.
