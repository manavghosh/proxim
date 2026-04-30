# Pipeline Log Pane — Design Spec

**Date:** 2026-04-30
**Status:** Approved
**Scope:** Live pipeline log pane on Dashboard — DB-persisted log entries streamed to UI via SSE

---

## 1. Goal

Show the candidate a real-time, human-readable log of every pipeline step as it happens — which job sites are being scraped, how many jobs were found, dedup results, and final summary — directly on the Dashboard page without opening the terminal.

---

## 2. Data Layer

### New table: `pipeline_logs`

Managed by Drizzle ORM (`src/db/schema.ts`). No new migration tool needed — `npm run db:generate && npm run db:migrate`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `defaultRandom()` |
| `pipelineJobId` | `uuid` FK → `pipeline_jobs.id` | Groups all log entries for one run |
| `level` | `text` NOT NULL | `'info'` / `'warning'` / `'error'` |
| `step` | `text` NOT NULL | e.g. `'scrape_naukri'`, `'dedup'`, `'persist_jobs'` |
| `message` | `text` NOT NULL | Human-readable log line |
| `data` | `jsonb` | Optional structured metadata e.g. `{"jobs_found": 12}` |
| `createdAt` | `timestamptz` NOT NULL `defaultNow()` | Used for ordering and incremental polling |

**Index:** `(pipelineJobId, createdAt)` — enables efficient incremental polling.

### Python DB helper

New function in `agent/agent/db.py`:

```python
async def insert_pipeline_log(
    pool, pipeline_job_id: str, level: str, step: str, message: str, data: dict | None = None
) -> None
```

Called from every `logger.info("pipeline_step", ...)` in `discovery.py`, replacing the structlog-only calls with both console log + DB write.

---

## 3. Python Agent Changes

### `agent/agent/graphs/discovery.py`

Each node that currently calls `logger.info("pipeline_step", ...)` is updated to also call `insert_pipeline_log`. A helper function `_log_step` is added to avoid repeating the pool management:

```python
async def _log(pool, job_id: str, level: str, step: str, message: str, data: dict | None = None):
    await insert_pipeline_log(pool, job_id, level=level, step=step, message=message, data=data)
```

**Log messages per step:**

| Step | Message |
|---|---|
| `build_queries` started | `"Generating search queries from your preferences"` |
| `build_queries` complete | `"Generated {N} queries across {sources}"` |
| `pipeline_fan_out` | `"Starting parallel scrape — {sources} active"` |
| `scrape_naukri` started | `"Scraping Naukri ({N} queries)…"` |
| `scrape_naukri` complete | `"Naukri complete — {N} jobs found"` |
| `scrape_iimjobs` started | `"Scraping iimjobs ({N} queries)…"` |
| `scrape_iimjobs` complete | `"iimjobs complete — {N} jobs found"` |
| `scrape_linkedin` started | `"Scraping LinkedIn ({N} queries)…"` |
| `scrape_linkedin` complete | `"LinkedIn complete — {N} jobs found"` |
| `scrape_careers_page` started | `"Scraping {N} custom job sites…"` |
| `scrape_careers_page` complete | `"Custom sites complete — {N} jobs found"` |
| `scrape_monster` | `"Monster not yet implemented — skipping"` |
| `normalise_and_dedup` started | `"Deduplicating {N} raw jobs…"` |
| `normalise_and_dedup` complete | `"{new} new jobs · {dupes} duplicates removed"` |
| `persist_jobs` started | `"Saving {N} jobs to database…"` |
| `persist_jobs` complete | `"Saved {N} jobs successfully"` |
| `write_run_summary` complete | `"Pipeline complete — {new} jobs discovered"` |
| Any warning | Source-specific message, level=`'warning'` |

---

## 4. SSE Stream Extension (`src/app/api/pipeline/[jobId]/stream/route.ts`)

The existing stream is extended to poll `pipeline_logs` incrementally on each 2-second tick. New rows since the last poll are pushed as `log_entry` events before the `status_update` event.

**New event format:**

```
event: log_entry
data: {"id":"uuid","level":"info","step":"scrape_naukri","message":"Naukri complete — 12 jobs found","data":{"jobs_found":12},"createdAt":"2026-04-30T16:35:38Z"}
```

**Polling logic:** Track `lastLogAt: string | null` — the `createdAt` of the most-recently-seen log entry. On each poll, query `pipeline_logs WHERE pipelineJobId = $1 AND createdAt > $2 ORDER BY createdAt ASC`. Push each new row as a `log_entry` event.

---

## 5. Dashboard UI

### Component: `src/components/dashboard/PipelineLogPane.tsx`

A `'use client'` component. Props: `jobId: string | null`.

**Behaviour:**
- When `jobId` is null: renders nothing
- When `jobId` is set: opens an `EventSource` to `/api/pipeline/{jobId}/stream`
- On `log_entry` event: appends entry to local `logs` state array
- On `completed` or `failed` event: appends final summary log entry, closes the stream
- Auto-scrolls to the latest entry on each new log
- Shows a "Clear" button after run completes

**Visual design:**
- Dark card (`bg-[#060d1f]`) with monospace font, max-height `320px`, overflow-y scroll
- Header: `"Pipeline Log"` label + animated green dot while running, grey when complete
- Each row: `[HH:MM:SS]` · icon · message
- Icons by level/step: `⚡` = started, `✅` = complete, `⚠️` = warning, `❌` = error, `💾` = persist, `🔄` = dedup

**Dashboard integration (`src/app/dashboard/page.tsx`):**
- Add `pipelineJobId` state (set when Run Pipeline is clicked)
- Render `<PipelineLogPane jobId={pipelineJobId} />` below the stat cards grid
- The pane slides in when jobId is set; absent when null

---

## 6. Files Changed

```
src/
  db/schema.ts                          ← +pipelineLogs table
  app/api/pipeline/[jobId]/stream/route.ts  ← extend SSE to push log_entry events
  app/dashboard/page.tsx                ← add pipelineJobId state, render PipelineLogPane
  components/dashboard/
    PipelineLogPane.tsx                 ← new component

agent/
  agent/db.py                           ← +insert_pipeline_log()
  agent/graphs/discovery.py             ← call _log() at each pipeline step
```

---

## 7. Out of Scope

- Persisting log history across page reloads (logs are cleared on navigation)
- Log filtering or search
- Logs for F9 scoring or F10 resume generation (future phases)
- Mobile layout

---

## 8. Success Criteria

- Clicking Run Pipeline shows the log pane immediately with "Starting discovery run"
- Each scraper start and complete appears within 3 seconds of the actual event
- Warning logs (e.g. rate-limited scraper) appear in amber
- Final "Pipeline complete — N jobs discovered" appears when run finishes
- The pane disappears / clears between runs
- All existing tests pass; TypeScript compiles with zero errors
