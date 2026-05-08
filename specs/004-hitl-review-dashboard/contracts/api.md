# API Contracts: HITL Review Dashboard (F4)

**Branch**: `004-hitl-review-dashboard` | **Date**: 2026-05-04

All endpoints follow the existing Proxim pattern: Next.js Route Handlers, scoped by `candidateId` query param.

---

## GET `/api/candidates/[id]/jobs`

Fetch all scoreable jobs (status: `scored` | `awaiting` | `snoozed`) for the HITL dashboard. F-grade and `discovered`/`score_failed` jobs are always excluded.

**Request**
```
GET /api/candidates/:id/jobs?filter=A+B&sort=score
```

Query params:
- `filter`: `'A'` | `'A+B'` | `'all'` — grade filter (default: `'A+B'`)
- `sort`: `'score'` | `'date'` | `'company'` — sort order (default: `'score'`)

**Response — 200 OK**
```json
{
  "jobs": [
    {
      "id": "uuid",
      "title": "Head of AI",
      "company": "Acme Corp",
      "location": "Bengaluru",
      "source": "naukri",
      "sourceUrl": "https://...",
      "postedAt": "2026-05-01T00:00:00Z",
      "status": "awaiting",
      "grade": "A",
      "numericScore": 4.6,
      "score10d": { ... },
      "reportMd": "## Executive Summary\n...",
      "archetype": "Agentic Systems Architect",
      "archetypeConfidence": 0.87,
      "hitlCheckpoint": {
        "id": "uuid",
        "status": "awaiting",
        "snoozedUntil": null,
        "createdAt": "2026-05-03T10:00:00Z"
      }
    }
  ],
  "total": 42
}
```

---

## GET `/api/candidates/[id]/jobs/stream`

Server-Sent Events stream. Pushes `jobs_arrived` events when new scored jobs appear for the candidate. Candidate-scoped, independent of pipeline run.

**Request**
```
GET /api/candidates/:id/jobs/stream
Accept: text/event-stream
```

**SSE Events**

New jobs:
```
event: jobs_arrived
data: {"count":2,"jobIds":["uuid1","uuid2"]}

```

Idle (no new jobs for 60s — client should reconnect):
```
event: idle
data: {}

```

Error recovery: browser `EventSource` reconnects automatically. Client listens for `idle` to close and reconnect after 3s.

**Polling behaviour**: Server polls DB every 5 seconds for jobs newer than the last seen `created_at`. Stream closes after 60 seconds of no new arrivals.

---

## POST `/api/jobs/[jobId]/approve`

Approve a job. Atomically: update `jobs.status = 'approved'`, create/update `hitl_checkpoints`, enqueue resume generation in `pipeline_jobs`.

**Request**
```
POST /api/jobs/:jobId/approve?candidateId=uuid
Content-Type: application/json

{}
```

**Response — 200 OK**
```json
{
  "jobId": "uuid",
  "status": "approved",
  "pipelineJobId": "uuid",
  "checkpointId": "uuid"
}
```

**Response — 409 Conflict** (already decided)
```json
{
  "error": "Job already decided",
  "currentStatus": "approved"
}
```

**Response — 422** (job not in approvable state)
```json
{
  "error": "Job must be in 'awaiting' or 'scored' status to approve"
}
```

**Atomic safety**: Uses conditional UPDATE (`WHERE status IN ('scored','awaiting')`) — if 0 rows affected, returns 409.

---

## POST `/api/jobs/[jobId]/reject`

Reject a job permanently. Updates `jobs.status = 'rejected'` and records in `hitl_checkpoints`. Rejected jobs never resurface.

**Request**
```
POST /api/jobs/:jobId/reject?candidateId=uuid
```

**Response — 200 OK**
```json
{
  "jobId": "uuid",
  "status": "rejected",
  "checkpointId": "uuid"
}
```

**Response — 409** (already decided — same as approve)

---

## POST `/api/jobs/[jobId]/snooze`

Snooze a job for 7 days. Updates `jobs.status = 'snoozed'`, records `snoozedUntil = now() + 7d` in `hitl_checkpoints`.

**Request**
```
POST /api/jobs/:jobId/snooze?candidateId=uuid
Content-Type: application/json

{ "days": 7 }
```

**Response — 200 OK**
```json
{
  "jobId": "uuid",
  "status": "snoozed",
  "snoozedUntil": "2026-05-11T10:00:00Z",
  "checkpointId": "uuid"
}
```

---

## Python Daemon Internal — Snooze Resurface

The Python daemon's secondary coroutine polls every 60 seconds:

```sql
SELECT hc.id, hc.job_id FROM hitl_checkpoints hc
WHERE hc.status = 'snoozed'
  AND hc.snoozed_until <= now()
```

For each expired snooze:
1. `UPDATE jobs SET status = 'awaiting' WHERE id = ?`
2. `UPDATE hitl_checkpoints SET status = 'awaiting', snoozed_until = NULL WHERE id = ?`

The SSE stream surfaces the job on the next 5-second poll.

---

## Error Propagation

| Scenario | HTTP Status | UI Behaviour |
|---|---|---|
| Approve succeeds, resume queue write fails | 500 | Job stays `awaiting`, error toast, retry button |
| Double-approve same job | 409 | "Already approved" toast, card refreshes to approved state |
| SSE disconnect | — | `EventSource.onerror` fires; client reconnects after 3s |
| Snooze resurface (daemon) | — | Job reappears in dashboard within 5s of resurface |
| F-grade job somehow in response | Never | API always excludes `grade = 'F'` in WHERE clause |
