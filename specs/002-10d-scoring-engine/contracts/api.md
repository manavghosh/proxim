# API Contracts: 10-Dimension Scoring Engine (F9)

**Phase 1 output** | Date: 2026-05-02

---

## New Endpoints

### `GET /api/jobs`

Returns scored jobs for the candidate, filtered by grade.

**Query params**:
- `grade` — `A` | `A+B` | `all` (default: `all`)

**Response 200**:
```json
{
  "jobs": [
    {
      "id": "uuid",
      "title": "Director of AI",
      "company": "Acme Corp",
      "location": "Bengaluru, Karnataka, India",
      "source": "linkedin",
      "sourceUrl": "https://linkedin.com/jobs/view/123",
      "postedAt": "2026-05-01",
      "status": "scored",
      "grade": "B",
      "score10d": { "gate": {...}, "weighted": {...} },
      "archetype": "GCC AI Practice Head",
      "archetypeConfidence": "0.82",
      "createdAt": "2026-05-02T07:00:00Z"
    }
  ]
}
```

**Filtering rules**:
- F-grade jobs are **always** excluded regardless of filter (FR-005)
- `discovered` and `score_failed` status jobs are excluded
- Filter is applied in the application layer (SQLite + PG compatible)

---

### `POST /api/jobs/[jobId]/decision`

Record the candidate's approve/reject/snooze decision.

**Request body**:
```json
{ "decision": "approved" }
```

`decision` must be one of: `approved` | `rejected` | `snoozed`

**Response 200**:
```json
{ "jobId": "uuid", "status": "approved" }
```

**Side effects**: Updates `jobs.status` to the decision value. No outbound actions fire (HITL gate — Constitution §I).

---

### `GET /api/jobs/[jobId]/report`

Returns the full 6-block markdown report for a scored job.

**Response 200**:
```json
{
  "reportMd": "## Executive Summary\n...\n\n## CV Match\n...",
  "grade": "B"
}
```

**Response 404**: Job not found.

---

## Modified Endpoints

### `GET /api/pipeline/[jobId]/status`

Extended to support chaining across `discovery_only` → `fetch_jds` → `score_jobs`.

**Added field in response**:
```json
{
  "jobId": "uuid",
  "status": "completed",
  "jobType": "fetch_jds",
  "followUpJobId": "uuid-of-score-jobs-job",
  ...
}
```

`followUpJobId` is non-null when:
- `jobType` is `discovery_only` and a `fetch_jds` job is queued/running for the same candidate, OR
- `jobType` is `fetch_jds` and a `score_jobs` job is queued/running for the same candidate

The dashboard status poll follows `followUpJobId` automatically, keeping the pipeline button in "running" state throughout all three phases.
