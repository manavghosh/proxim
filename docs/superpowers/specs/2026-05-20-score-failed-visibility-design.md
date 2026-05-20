# Score Failure Visibility — Design Spec
**Date:** 2026-05-20
**Status:** Approved for implementation

---

## 1. Problem

When a job fails scoring (`score_failed` status), the user has no way to discover it. The job is hidden from the Pipeline page, the Applications page, and every other UI surface. The user sees "Go to Pipeline" after importing, finds nothing there, and has no feedback about what went wrong or how to recover.

The broader principle: every error the backend produces must surface to the user with a plain-language reason and a clear next action.

---

## 2. Goals

1. Store a user-friendly error reason on the `jobs` row when scoring fails.
2. Show all `score_failed` jobs in a collapsible "Failed to Score" section at the bottom of the Pipeline page.
3. Provide per-job Retry and Retry All actions that feed progress into the existing Pipeline Log Pane.
4. Never show raw exception messages — always translate to plain English.

---

## 3. Scope

| Layer | Change |
|---|---|
| DB schema | Add `errorMessage text` to `jobs` table (PG + SQLite) |
| Python scoring engine | `mark_job_score_failed` accepts + writes a friendly reason |
| Python scoring engine | Map exception types to friendly strings before calling `mark_job_score_failed` |
| `db_sqlite.py` | Update `mark_job_score_failed` signature to accept `error_message` |
| `db_pg.py` | Same update |
| API — candidates jobs route | Include `errorMessage` in returned job fields |
| API — new retry-scoring endpoint | `POST /api/jobs/[jobId]/retry-scoring` |
| `HitlJob` type | Add `errorMessage: string \| null` |
| UI — Pipeline page | "Failed to Score" collapsible section |
| UI — new `ScoreFailedCard` component | Compact card: title, company, reason, source link, Retry button |

Out of scope: surfacing `discovered` jobs with empty JD (separate issue), resume failures, LinkedIn connector failures.

---

## 4. Error → Friendly Message Mapping

Applied in `scoring_engine.py` before calling `mark_job_score_failed`:

| Condition | User-facing message |
|---|---|
| `job.get("jd_raw", "").strip() == ""` (empty JD, checked before calling LLM) | `"No job description found — try re-importing with a direct job URL"` |
| `"finish_reason=length"` in error string | `"Job description was too long to process — try re-importing with a shorter listing"` |
| `"rate"` in error string or `"429"` in error string | `"Scoring rate limit reached — click Retry in a few minutes"` |
| `isinstance(e, (KeyError, ValidationError))` or key name in error string | `"Job description was too short or malformed to score"` |
| `"Empty response"` in error string | `"No job description found — try re-importing with a direct job URL"` |
| Anything else | `"Scoring failed unexpectedly — click Retry to try again"` |

The mapping lives in a single helper `_friendly_score_error(e: Exception, job: dict) -> str` in `scoring_engine.py`.

---

## 5. Schema Changes

### PostgreSQL (`src/db/schema.ts`)
Add to `jobs` table after `reportMd`:
```typescript
errorMessage: text(),
```

### SQLite (`src/db/schema.sqlite.ts`)
Add to `jobs` table:
```typescript
errorMessage: text(),
```

### Drizzle migration
`npm run db:generate` → new migration file.

### SQLite dev migration
`migrations/sqlite/0008_add_jobs_error_message.sql`:
```sql
ALTER TABLE jobs ADD COLUMN error_message TEXT;
```

---

## 6. Python Changes

### `db_sqlite.py` — `mark_job_score_failed`

Current signature:
```python
async def mark_job_score_failed(pool, job_id: str) -> None:
```

New signature:
```python
async def mark_job_score_failed(pool, job_id: str, error_message: str = "") -> None:
```

SQL update adds `error_message = ?` when `error_message` is non-empty.

### `db_pg.py` — same change.

### `scoring_engine.py`

Add helper:
```python
def _friendly_score_error(exc: Exception, job: dict) -> str:
    jd = job.get("jd_raw", "").strip()
    if not jd:
        return "No job description found — try re-importing with a direct job URL"
    s = str(exc).lower()
    if "finish_reason=length" in s:
        return "Job description was too long to process"
    if "rate" in s or "429" in s:
        return "Scoring rate limit reached — click Retry in a few minutes"
    if "empty response" in s:
        return "No job description found — try re-importing with a direct job URL"
    if isinstance(exc, (KeyError, ValidationError)) or any(
        k in str(exc) for k in ["weighted", "gate", "growth_trajectory", "company_stage"]
    ):
        return "Job description was too short or malformed to score"
    return "Scoring failed unexpectedly — click Retry to try again"
```

In `score_and_report_batch`, replace:
```python
await mark_job_score_failed(pool, job["id"])
```
with:
```python
friendly = _friendly_score_error(e, job)
await mark_job_score_failed(pool, job["id"], error_message=friendly)
```

---

## 7. API Changes

### `GET /api/candidates/[id]/jobs`

Add `errorMessage` to the select and mapping. The route currently excludes `score_failed` — change to **include** it so the Pipeline page can show the failed section.

Remove `score_failed` from `EXCLUDED_STATUSES` in this route.

Map `errorMessage` in the response:
```typescript
errorMessage: r.jobErrorMessage ?? null,
```

### New: `POST /api/jobs/[jobId]/retry-scoring`

File: `src/app/api/jobs/[jobId]/retry-scoring/route.ts`

Logic:
1. Load job — verify it belongs to `candidateId` and has status `score_failed`.
2. Reset job: `UPDATE jobs SET status = 'discovered', error_message = NULL WHERE id = $jobId`.
3. Queue pipeline job: `INSERT INTO pipeline_jobs (job_type, candidate_id, payload) VALUES ('score_jobs', $candidateId, {job_ids: [$jobId]})`.
4. Return `{ pipelineJobId, status: 'queued' }`.

Returns 422 if job is not in `score_failed` status.

---

## 8. Type Changes

### `HitlJob` in `src/lib/api.ts`
Add:
```typescript
errorMessage: string | null
```

---

## 9. UI Changes

### New component: `src/components/pipeline/ScoreFailedSection.tsx`

Props:
```typescript
interface Props {
  jobs: HitlJob[]           // only score_failed jobs
  candidateId: string
  onRetried: (pipelineJobId: string) => void   // feeds log pane
}
```

Layout (collapsed by default, `useState(false)` for open):

**Header row** (always visible):
```
⚠  N job(s) could not be scored     [Retry All]  ▾/▴
```
- Amber/warning colour for the ⚠ icon and count
- "Retry All" calls existing `POST /api/jobs/reset-failed` then queues `score_jobs`; returns `pipelineJobId` via `onRetried`
- Chevron toggles the body

**Body** (one row per job when expanded):
```
[title — company]  ↗        [Retry]
[friendly reason in muted text]
```
- ↗ links to `job.sourceUrl` in a new tab
- Per-job Retry calls `POST /api/jobs/[jobId]/retry-scoring`; on success calls `onRetried(pipelineJobId)`
- While retrying, button shows spinner and is disabled

### Pipeline page (`src/app/candidates/[id]/pipeline/page.tsx`)

- Import `ScoreFailedSection`
- Split loaded jobs: `scoredJobs = jobs.filter(j => j.status !== 'score_failed')` and `failedJobs = jobs.filter(j => j.status === 'score_failed')`
- Render `scoredJobs` in the existing list
- Render `<ScoreFailedSection>` below the list when `failedJobs.length > 0`
- `onRetried` callback: push the returned `pipelineJobId` into `resumeBuilderJobIds` state (re-uses existing log pane tracking) — or add a dedicated `retryJobIds` state fed to the log pane

---

## 10. Files Touched

```
src/db/schema.ts                                     — add errorMessage to jobs
src/db/schema.sqlite.ts                              — same
migrations/XXXX_add_jobs_error_message.sql           — PG migration (generated)
migrations/sqlite/0008_add_jobs_error_message.sql    — SQLite migration
agent/agent/db_sqlite.py                             — mark_job_score_failed + error_message
agent/agent/db_pg.py                                 — same
agent/agent/scoring_engine.py                        — _friendly_score_error helper + call site
src/lib/api.ts                                       — add errorMessage to HitlJob
src/app/api/candidates/[id]/jobs/route.ts            — include score_failed, map errorMessage
src/app/api/jobs/[jobId]/retry-scoring/route.ts      — new endpoint
src/components/pipeline/ScoreFailedSection.tsx       — new component
src/app/candidates/[id]/pipeline/page.tsx            — wire ScoreFailedSection
```
