# Feature Specification: Pipeline Analytics Dashboard (F7)

**Feature Branch**: `007-pipeline-analytics-dashboard`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 5 — Dashboard

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Real-Time Pipeline Status View (Priority: P1)

The candidate opens the Applications page and sees the live state of every job in their active pipeline — which stage each is at, what the current agent is doing, and any errors requiring their attention.

**Why this priority**: Without pipeline visibility, the candidate has no idea whether the system is working or stuck. Real-time status is the operational heartbeat of the product.

**Independent Test**: Can be tested by running a fixture pipeline with one job in each stage and verifying all stages are correctly reflected on the dashboard within 5 seconds.

**Acceptance Scenarios**:

1. **Given** jobs are in active pipeline stages (Discovered / Scored / Awaiting Review / Resume Generated / Outreach / Replied), **When** the candidate loads the Applications page, **Then** each job displays its current stage, elapsed time in that stage, and the last agent action.
2. **Given** an agent errors on a job, **When** the candidate views the dashboard, **Then** an error card appears with a description of the failure and a manual retry button.
3. **Given** the pipeline advances a job to a new stage, **When** the dashboard is open, **Then** the job card updates to the new stage within 5 seconds via live update.
4. **Given** the candidate clicks the retry button on a failed job, **When** confirmed, **Then** a new pipeline job is enqueued for that job starting from the failed stage.

---

### User Story 2 — Campaign Performance Metrics (Priority: P2)

The candidate views aggregate metrics across all pipeline runs: grade distribution, email open/reply rates, LinkedIn acceptance rates, and interview conversion.

**Why this priority**: Without metrics, the candidate cannot calibrate their preferences, assess the system's effectiveness, or know whether to change their approach.

**Independent Test**: Can be tested by seeding the database with fixture pipeline run data and verifying all metric cards display correct aggregated values.

**Acceptance Scenarios**:

1. **Given** multiple pipeline runs have completed, **When** the candidate views the analytics section, **Then** they see: jobs discovered per run, A/B grade rate, email open rate, reply rate, LinkedIn acceptance rate, and interview callback rate.
2. **Given** the candidate selects a time range filter, **When** the filter is applied, **Then** all metrics update to reflect only runs within that range.

---

### User Story 3 — Run History and Export (Priority: P3)

The candidate reviews historical pipeline runs and can export their full pipeline history to CSV for personal records or external analysis.

**Why this priority**: A structured job search generates substantial data over weeks. Exportability gives the candidate ownership of their history.

**Independent Test**: Can be tested by triggering a CSV export and verifying all pipeline run rows are correctly formatted and complete.

**Acceptance Scenarios**:

1. **Given** the candidate navigates to the run history section, **When** it loads, **Then** they see a list of past runs with: start time, jobs discovered, A/B grade count, resumes sent, emails sent, replies received.
2. **Given** the candidate clicks Export to CSV, **When** the download completes, **Then** the CSV contains one row per pipeline run with all key metrics.

---

### Edge Cases

- What if pipeline metrics are queried against a large dataset (thousands of jobs over many months)? → Metric queries are aggregated on read with appropriate query optimisation; individual run history is paginated at 50 rows per page.
- What if a pipeline run is still in progress when the analytics load? → In-progress runs are shown separately with a "running" indicator; their partial data is excluded from aggregate metrics until the run completes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Applications page MUST show every active job with its current pipeline stage, elapsed time in stage, and last agent action.
- **FR-002**: Per-agent status MUST be shown for active runs: idle / running / waiting-HITL / error.
- **FR-003**: Error cards MUST include: which agent failed, failure description, timestamp, and a retry button.
- **FR-004**: The retry button MUST enqueue a new pipeline job starting from the failed stage (not from discovery).
- **FR-005**: Pipeline stage updates MUST be pushed to the open dashboard within 5 seconds via server-sent events.
- **FR-006**: The dashboard MUST display these aggregate metrics: jobs discovered per run, A/B grade rate (%), email open rate (%), email reply rate (%), LinkedIn acceptance rate (%), interview callback rate (%).
- **FR-007**: A time range filter (last 7 days / 30 days / 90 days / all time) MUST be available and all metrics MUST update when the filter changes.
- **FR-008**: A grade distribution chart (A/B/C/D/F counts) MUST be shown for all scored jobs in the selected period.
- **FR-009**: Run history MUST list each completed run with: start time, duration, jobs discovered, A/B graded, resumes generated, emails sent, replies.
- **FR-010**: Run history MUST be paginated at 50 rows per page.
- **FR-011**: A CSV export MUST be available for the full run history or a filtered time range.
- **FR-012**: In-progress runs MUST be visually distinguished from completed runs and excluded from aggregate metric calculations until complete.
- **FR-013**: The Applications page (`/applications`) replaces the current Phase 1 placeholder page.

### Key Entities

- **Pipeline Run** (`pipeline_runs`): Extended with aggregate fields populated at run completion: `jobs_discovered`, `ab_grade_count`, `resumes_generated`, `emails_sent`, `replies_received`.
- **Agent Status**: Derived from the current state of `pipeline_jobs` for a run — not a separate table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pipeline stage updates appear on the open dashboard within 5 seconds of the database write.
- **SC-002**: All metric cards load within 3 seconds for up to 12 months of pipeline history.
- **SC-003**: CSV export completes within 10 seconds for up to 500 pipeline runs.
- **SC-004**: Manual retry from an error card successfully re-queues the failed job in 100% of attempts.

## Assumptions

- All previous pipeline phases (F2, F9, F10, F4, F5, F6) are complete and generating the data that this dashboard aggregates.
- Interview callback rate is self-reported by the candidate via a simple "Mark as Interview" action on a job card — the system cannot detect interviews automatically.
- The SSE stream used here reuses the same pattern established in F4 (HITL dashboard) — same `/api/pipeline/[jobId]/stream` infrastructure.
- Weekly summary emails (optional per PRD) are out of scope for the initial implementation.
