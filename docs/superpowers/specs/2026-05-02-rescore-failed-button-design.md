# Rescore Failed Button — Design

**Date:** 2026-05-02

## Problem

When `score_jobs` fails for individual jobs, they are marked `score_failed` in the DB. Currently, recovering them requires running SQL manually. There is no UI mechanism to reset failed jobs for rescoring, and the failure reason is buried in the `data` JSON field of the pipeline log rather than visible inline.

## Goals

- Dashboard button to reset all `score_failed` jobs back to `discovered`
- Button only visible when at least one `score_failed` job exists
- On reset, write a summary log entry to the most recent `score_jobs` pipeline job listing each failed job and its error reason
- Fix scoring log messages to include the actual error inline for all future failures

## Out of Scope

- Auto-triggering `score_jobs` after reset (user triggers manually)
- Per-job rescore (batch reset only)
- New pipeline job type for the reset action

---

## API Layer

### `GET /api/jobs/stats`

Returns the count of jobs in `score_failed` status.

**Response:**
```json
{ "scoreFailed": 3 }
```

Fetched by the dashboard on mount and after a reset to determine button visibility.

### `POST /api/jobs/reset-failed`

Resets all `score_failed` jobs to `discovered` and appends a summary log to the most recent `score_jobs` pipeline job.

**Steps:**
1. Query all `score_failed` jobs (id, title, company)
2. For each job, find the most recent `warning` entry in `pipeline_logs` where `data->>'job_id'` matches — extract the error reason
3. Reset all `score_failed → discovered` in a single UPDATE
4. Find the most recent `score_jobs` pipeline job (any status)
5. Append one `info` log entry per failed job: `"Reset: {title} @ {company} — {error reason}"`
6. Append a summary log entry: `"Reset {N} failed jobs — ready to rescore"`

**Response:**
```json
{ "reset": 3 }
```

If no `score_jobs` pipeline job exists, skip the log step (don't error).

---

## Scoring Log Message Fix

**File:** `agent/agent/graphs/scoring.py`

Change the warning log message from:
```
Skipped: {title} @ {company} (LLM error — marked score_failed)
```
to:
```
Skipped: {title} @ {company} — {error[:120]} (marked score_failed)
```

`str(e)` is already available in the except block. Truncate to 120 characters to keep the log pane readable.

---

## Dashboard UI

**File:** `src/app/dashboard/page.tsx` (and any child component that owns the trigger buttons)

- On mount: fetch `GET /api/jobs/stats` to get `scoreFailed`
- Render "Rescore Failed (N)" button only when `scoreFailed > 0`
- On click: `POST /api/jobs/reset-failed`, show toast "N jobs reset — trigger Score Jobs to rescore", refresh stats
- After refresh, `scoreFailed` drops to 0 and button hides

Button placement: alongside the existing pipeline trigger buttons.

---

## Data Flow

```
Dashboard mounts
  → GET /api/jobs/stats → { scoreFailed: N }
  → if N > 0: render "Rescore Failed (N)" button

User clicks button
  → POST /api/jobs/reset-failed
      → query score_failed jobs + their error reasons from pipeline_logs
      → UPDATE jobs SET status = 'discovered' WHERE status = 'score_failed'
      → find most recent score_jobs pipeline job
      → INSERT pipeline_logs: one entry per job + one summary entry
      → return { reset: N }
  → toast "N jobs reset — trigger Score Jobs to rescore"
  → GET /api/jobs/stats → { scoreFailed: 0 }
  → button hides
```

---

## Error Handling

- If `reset-failed` finds 0 `score_failed` jobs, return `{ reset: 0 }` with no DB writes
- If the pipeline log INSERT fails, swallow the error — the reset still completes
- If `GET /api/jobs/stats` fails on mount, default to `scoreFailed: 0` (button stays hidden)
