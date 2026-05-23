# API Contracts: Pipeline Analytics Dashboard (F7)

**Branch**: `proxim-mvp` | **Date**: 2026-05-22

All endpoints follow the existing Proxim pattern: Next.js 15 App Router Route Handlers, candidate-scoped via `[id]` path param or `?candidateId=` query param.

---

## GET `/api/candidates/[id]/analytics`

Returns aggregate metrics for the candidate over the selected time range. In-progress runs are counted separately but excluded from rate calculations.

**Request**
```
GET /api/candidates/:id/analytics?range=30d
```

Query params:
- `range`: `'7d'` | `'30d'` | `'90d'` | `'all'` (default: `'30d'`)

**Response — 200 OK**
```json
{
  "metrics": {
    "totalJobsDiscovered": 142,
    "abGradeRate": 34,
    "emailOpenRate": 58,
    "emailReplyRate": 12,
    "linkedInAcceptRate": 41,
    "interviewCallbackRate": 8,
    "gradeDistribution": {
      "A": 18, "B": 30, "C": 45, "D": 28, "E": 11, "F": 10
    },
    "totalRuns": 6,
    "inProgressRuns": 1
  },
  "range": "30d"
}
```

Notes:
- Rate fields are integers (0–100). If denominator is zero, value is `null`.
- `inProgressRuns` count is informational only — their data is excluded from all rates.
- `gradeDistribution` counts all graded jobs (including F) in completed runs within the time range.

**Response — 200 OK (no runs in range)**
```json
{
  "metrics": {
    "totalJobsDiscovered": 0,
    "abGradeRate": null,
    "emailOpenRate": null,
    "emailReplyRate": null,
    "linkedInAcceptRate": null,
    "interviewCallbackRate": null,
    "gradeDistribution": { "A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "F": 0 },
    "totalRuns": 0,
    "inProgressRuns": 0
  },
  "range": "30d"
}
```

---

## GET `/api/candidates/[id]/analytics/runs`

Paginated run history. Completed and failed runs only. In-progress runs excluded.

**Request**
```
GET /api/candidates/:id/analytics/runs?page=1&range=all
```

Query params:
- `page`: integer ≥ 1 (default: `1`)
- `range`: `'7d'` | `'30d'` | `'90d'` | `'all'` (default: `'all'`)

**Response — 200 OK**
```json
{
  "runs": [
    {
      "id": "uuid",
      "status": "completed",
      "startedAt": "2026-05-20T08:00:00Z",
      "completedAt": "2026-05-20T08:14:32Z",
      "durationSeconds": 872,
      "jobsDiscovered": 47,
      "abGradeCount": 12,
      "resumesGenerated": 8,
      "emailsSent": 5,
      "repliesReceived": 1
    }
  ],
  "total": 12,
  "page": 1,
  "totalPages": 1
}
```

- Max 50 rows per page (FR-010).
- Sorted by `startedAt` DESC.

---

## GET `/api/candidates/[id]/analytics/export`

CSV download of full run history (or filtered by time range).

**Request**
```
GET /api/candidates/:id/analytics/export?range=all
```

Query params:
- `range`: `'7d'` | `'30d'` | `'90d'` | `'all'` (default: `'all'`)

**Response — 200 OK**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="pipeline-history.csv"

run_id,started_at,completed_at,duration_minutes,jobs_discovered,ab_grade_count,resumes_generated,emails_sent,replies_received,status
uuid,2026-05-20T08:00:00Z,2026-05-20T08:14:32Z,14,47,12,8,5,1,completed
...
```

- Only `completed` and `failed` runs are included.
- `completed_at` and `duration_minutes` are empty string for `failed` runs without a completion timestamp.
- All 500 rows streamed in a single response (SC-003: ≤10s).

---

## POST `/api/jobs/[jobId]/interview`

Mark (or unmark) a job as having resulted in an interview callback. Idempotent — calling again with `mark: true` when already marked is a no-op.

**Request**
```
POST /api/jobs/:jobId/interview?candidateId=uuid
Content-Type: application/json

{ "mark": true }
```

`mark: false` clears `interviewCallbackAt` (unmark, for accidental clicks).

**Response — 200 OK**
```json
{
  "jobId": "uuid",
  "interviewCallbackAt": "2026-05-22T10:00:00Z"
}
```

**Response — 200 OK (unmark)**
```json
{
  "jobId": "uuid",
  "interviewCallbackAt": null
}
```

**Response — 404** (job not found or wrong candidateId)

---

## POST `/api/jobs/[jobId]/retry-stage`

Re-enqueue a failed pipeline stage. Finds the most recently failed `pipeline_jobs` row for this job, inserts a new row with the same `job_type`, and resets the job's processing status.

**Request**
```
POST /api/jobs/:jobId/retry-stage?candidateId=uuid
```

No body required.

**Response — 200 OK**
```json
{
  "jobId": "uuid",
  "newPipelineJobId": "uuid",
  "jobType": "resume_builder",
  "resetJobStatus": "approved"
}
```

`resetJobStatus` is the `jobs.status` value the job was set to in order to be ready for the retried agent.

**Response — 404** (no failed pipeline_jobs found for this job)
```json
{ "error": "No failed pipeline job found for this job" }
```

**Response — 409** (another pipeline job for this job is already running)
```json
{ "error": "A pipeline job for this job is already running", "activeJobId": "uuid" }
```

**Note**: Route is named `retry-stage` (not bare `retry`) to align with existing conventions `retry-scoring` and `retry-linkedin`.

---

## Modifications to Existing Endpoints

### `GET /api/jobs` (Applications page route) — additions

**Important**: The Applications page uses `GET /api/jobs` (`src/app/api/jobs/route.ts`), not `GET /api/candidates/[id]/jobs` (the HITL Pipeline review-queue). The four new fields are added to `GET /api/jobs`.

```json
{
  "jobs": [
    {
      "...": "...existing fields...",
      "updatedAt": "2026-05-22T09:45:00Z",
      "interviewCallbackAt": null,
      "errorMessage": null,
      "pipelineJobStatus": "running"
    }
  ]
}
```

- `updatedAt`: from `jobs.updatedAt` (`$onUpdateFn`); used to compute elapsed time in stage and as the error timestamp fallback.
- `interviewCallbackAt`: new F7 field; drives the "Mark as Interview" button state.
- `errorMessage`: from `jobs.errorMessage`; non-null value triggers the error card on the job card.
- `pipelineJobStatus`: latest `pipeline_jobs.status` for this job (via LEFT JOIN on most-recent pipeline_jobs row); used to derive the per-agent status badge (`running` → "Running", `queued` → "Queued", `failed` + `errorMessage` → "Error").

### `GET /api/candidates/[id]/jobs/stream` (F4 SSE) — new event type

A new `run_status_changed` event is pushed when any `pipeline_runs.status` changes for the candidate (e.g., a run transitions `running → completed`). This lets the Analytics tab refresh metrics automatically.

```
event: run_status_changed
data: {"runId":"uuid","status":"completed","candidateId":"uuid"}
```

The Applications page client reacts by silently refreshing the analytics panel when this event arrives and the Analytics tab is active.

---

## Error Propagation

| Scenario | HTTP Status | UI Behaviour |
|---|---|---|
| Analytics query error | 500 | Error state in analytics panel; retry button |
| No runs in range | 200 (empty metrics) | "No pipeline runs in this period" empty state |
| Export for 0 runs | 200 (header row only) | CSV downloads with header only |
| retry-stage with no failed job | 404 | Toast: "No failed stage found to retry" |
| retry-stage with active running job | 409 | Toast: "Pipeline already running for this job" |
| Interview mark on non-existent job | 404 | Toast: "Job not found" |
