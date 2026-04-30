# API Contracts: Job Discovery Agent (F2)

**Phase 1 output** | Date: 2026-04-30

New Next.js Route Handlers introduced by this feature.

---

## POST /api/pipeline/trigger

**Purpose**: Enqueue a pipeline job. Next.js inserts a `pipeline_jobs` row and returns the job ID immediately. The Python agent picks it up within 3 seconds.

**Request body**:
```json
{
  "jobType": "full_pipeline" | "discovery_only"
}
```

**Success response** (`201 Created`):
```json
{
  "jobId": "uuid",
  "status": "queued",
  "createdAt": "2026-04-30T12:00:00Z"
}
```

**Error responses**:
- `400` — missing or invalid `jobType`
- `409` — a pipeline job is already `queued` or `running` for this candidate
- `500` — database error

**Behaviour**: Uses `getOrCreateCandidate()` to find the candidate. Inserts into `pipeline_jobs` and returns. Does NOT call the Python service (Constitution §VII).

---

## GET /api/pipeline/[jobId]/status

**Purpose**: Snapshot of a pipeline job's current state — used for polling-based status checks.

**Path params**: `jobId` — UUID of the pipeline job

**Success response** (`200 OK`):
```json
{
  "jobId": "uuid",
  "status": "queued" | "running" | "completed" | "failed",
  "jobType": "full_pipeline" | "discovery_only",
  "createdAt": "2026-04-30T12:00:00Z",
  "startedAt": "2026-04-30T12:00:03Z" | null,
  "completedAt": "2026-04-30T12:08:45Z" | null,
  "error": null | "string",
  "pipelineRun": {
    "id": "uuid",
    "status": "running" | "completed" | "failed" | "partial",
    "sourcesAttempted": 4,
    "sourcesSuccessful": 3,
    "jobsDiscovered": 47,
    "jobsDeduplicated": 12,
    "summary": { ... },
    "startedAt": "2026-04-30T12:00:04Z",
    "completedAt": null
  } | null
}
```

**Error responses**:
- `404` — `jobId` not found or does not belong to this candidate

---

## GET /api/pipeline/[jobId]/stream

**Purpose**: Server-Sent Events stream pushing state updates until the job reaches a terminal state (`completed` | `failed`).

**Path params**: `jobId` — UUID of the pipeline job

**Content-Type**: `text/event-stream`

**Event format**:
```
event: status_update
data: {"status": "running", "jobsDiscovered": 12, "sourcesSuccessful": 2}

event: completed
data: {"status": "completed", "jobsDiscovered": 47, "jobsDeduplicated": 12}

event: failed
data: {"status": "failed", "error": "All sources failed"}
```

**Behaviour**:
- Polls `pipeline_jobs` + `pipeline_runs` in Neon every 2 seconds (per Constitution §VII)
- Pushes `status_update` event on any state change
- Pushes `completed` or `failed` event and closes the stream on terminal state
- Uses native `ReadableStream` Web API (per Constitution §VII — never `res.write` or EventEmitter)
- Client MUST reconnect on disconnect using the `EventSource` API's built-in retry behaviour

**Error responses**:
- `404` — `jobId` not found

---

## Python Agent Service: GET /health

**Purpose**: Docker / deployment health check endpoint. Only endpoint exposed by the Python agent service.

**Success response** (`200 OK`):
```json
{
  "status": "ok",
  "daemon": "running",
  "dbConnected": true
}
```

**Failure response** (`503 Service Unavailable`):
```json
{
  "status": "degraded",
  "daemon": "running",
  "dbConnected": false,
  "error": "Connection pool exhausted"
}
```

This endpoint is served by a minimal FastAPI app running on port `8001` inside the container, in a background thread alongside the polling daemon. It does NOT accept any other routes.
