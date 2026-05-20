# Score Failure Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `score_failed` jobs on the Pipeline page in a collapsible "Failed to Score" section with user-friendly error reasons and per-job Retry buttons, so users are never left wondering why their imports disappeared.

**Architecture:** Add `error_message` to the `jobs` table; write a friendly reason when scoring fails; remove `score_failed` from the Pipeline API exclusion list; new `ScoreFailedSection` component below the job list; new per-job `retry-scoring` API endpoint that resets a single job and queues scoring.

**Tech Stack:** Next.js 15, Drizzle ORM (PostgreSQL + SQLite), Python aiosqlite/asyncpg, LangGraph, Vitest + Testing Library

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/db/schema.ts` | Modify | Add `errorMessage` to `jobs` table |
| `src/db/schema.sqlite.ts` | Modify | Same for SQLite |
| `migrations/XXXX_*.sql` | Generated | PG migration |
| `migrations/sqlite/0008_add_jobs_error_message.sql` | Create | SQLite migration |
| `agent/agent/db_sqlite.py` | Modify | `mark_job_score_failed` accepts `error_message` |
| `agent/agent/db_pg.py` | Modify | Same |
| `agent/agent/scoring_engine.py` | Modify | `_friendly_score_error` helper + call site |
| `agent/agent/graphs/scoring.py` | Modify | Pass friendly error to `mark_job_score_failed` |
| `src/lib/api.ts` | Modify | Add `errorMessage` to `HitlJob`; add `retryScoring` fn |
| `src/app/api/candidates/[id]/jobs/route.ts` | Modify | Include `score_failed`; map `errorMessage` |
| `src/app/api/jobs/[jobId]/retry-scoring/route.ts` | Create | Per-job reset + score queue |
| `src/components/pipeline/ScoreFailedSection.tsx` | Create | Collapsible failed-jobs strip |
| `src/__tests__/components/ScoreFailedSection.test.tsx` | Create | Component tests |
| `src/app/candidates/[id]/pipeline/page.tsx` | Modify | Wire `ScoreFailedSection` + log pane |

---

### Task 1: Add `errorMessage` to the `jobs` schema and run migrations

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/schema.sqlite.ts`
- Generated: `migrations/XXXX_*.sql`
- Create: `migrations/sqlite/0008_add_jobs_error_message.sql`

- [ ] **Step 1: Add column to PG schema**

In `src/db/schema.ts`, find the `jobs` table. After `reportMd: text(),` add:

```typescript
  errorMessage:        text(),
```

- [ ] **Step 2: Add column to SQLite schema**

In `src/db/schema.sqlite.ts`, find the `jobs` table. After `reportMd: text(),` add:

```typescript
  errorMessage:   text(),
```

- [ ] **Step 3: Generate PG migration**

```bash
npm run db:generate
```

Expected: new file in `migrations/` containing:
```sql
ALTER TABLE "jobs" ADD COLUMN "error_message" text;
```

- [ ] **Step 4: Apply PG migration**

```bash
npm run db:migrate
```

Expected: exits 0 (or connection-timeout if no live DB — migration file still committed).

- [ ] **Step 5: Create and apply SQLite migration**

Create `migrations/sqlite/0008_add_jobs_error_message.sql`:
```sql
ALTER TABLE jobs ADD COLUMN error_message TEXT;
```

Apply to local dev DB:
```bash
cd agent
poetry run python -c "
import asyncio, aiosqlite
async def main():
    async with aiosqlite.connect('../proxim-dev.db') as db:
        try:
            await db.execute('ALTER TABLE jobs ADD COLUMN error_message TEXT')
            await db.commit()
            print('Migration applied')
        except Exception as e:
            print(f'Result: {e}')
asyncio.run(main())
"
```
Expected: `Migration applied` or `Result: duplicate column name: error_message`.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/schema.sqlite.ts migrations/ "migrations/sqlite/0008_add_jobs_error_message.sql"
git commit -m "feat: add error_message column to jobs table"
```

---

### Task 2: Python — friendly error helper + `mark_job_score_failed` update

**Files:**
- Modify: `agent/agent/db_sqlite.py`
- Modify: `agent/agent/db_pg.py`
- Modify: `agent/agent/scoring_engine.py`
- Modify: `agent/agent/graphs/scoring.py`

- [ ] **Step 1: Update `mark_job_score_failed` in `db_sqlite.py`**

Find `mark_job_score_failed` (around line 374). Replace:

```python
async def mark_job_score_failed(
    pool: aiosqlite.Connection,
    job_id: str,
) -> None:
    await pool.execute(
        "UPDATE jobs SET status = 'score_failed', updated_at = ? WHERE id = ?",
        (_now(), job_id),
    )
    await pool.commit()
```

With:

```python
async def mark_job_score_failed(
    pool: aiosqlite.Connection,
    job_id: str,
    error_message: str = "",
) -> None:
    if error_message:
        await pool.execute(
            "UPDATE jobs SET status = 'score_failed', error_message = ?, updated_at = ? WHERE id = ?",
            (error_message[:500], _now(), job_id),
        )
    else:
        await pool.execute(
            "UPDATE jobs SET status = 'score_failed', updated_at = ? WHERE id = ?",
            (_now(), job_id),
        )
    await pool.commit()
```

- [ ] **Step 2: Update `mark_job_score_failed` in `db_pg.py`**

Find `mark_job_score_failed` (around line 316). Replace:

```python
async def mark_job_score_failed(
    pool: asyncpg.Pool,
    job_id: str,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET status = 'score_failed', updated_at = NOW() WHERE id = $1",
            job_id,
        )
```

With:

```python
async def mark_job_score_failed(
    pool: asyncpg.Pool,
    job_id: str,
    error_message: str = "",
) -> None:
    async with pool.acquire() as conn:
        if error_message:
            await conn.execute(
                "UPDATE jobs SET status = 'score_failed', error_message = $1, updated_at = NOW() WHERE id = $2",
                error_message[:500], job_id,
            )
        else:
            await conn.execute(
                "UPDATE jobs SET status = 'score_failed', updated_at = NOW() WHERE id = $1",
                job_id,
            )
```

- [ ] **Step 3: Add `_friendly_score_error` to `scoring_engine.py`**

Add this function after the `ARCHETYPES` list (before `truncate_jd`):

```python
def _friendly_score_error(exc: Exception, job: dict) -> str:
    """Map a scoring exception to a plain-English reason for the UI."""
    from pydantic import ValidationError as _PydanticError
    jd = (job.get("jd_raw") or "").strip()
    if not jd:
        return "No job description found — try re-importing with a direct job URL"
    s = str(exc).lower()
    if "finish_reason=length" in s:
        return "Job description was too long to process"
    if "rate" in s or "429" in s:
        return "Scoring rate limit reached — click Retry in a few minutes"
    if "empty response" in s:
        return "No job description found — try re-importing with a direct job URL"
    if isinstance(exc, (KeyError, _PydanticError)) or any(
        k in str(exc) for k in ["weighted", "gate", "growth_trajectory", "company_stage",
                                  "role_level_match", "ai_stack_alignment"]
    ):
        return "Job description was too short or malformed to score"
    return "Scoring failed unexpectedly — click Retry to try again"
```

- [ ] **Step 4: Use `_friendly_score_error` in `scoring.py`**

In `agent/agent/graphs/scoring.py`, find the `except Exception as e:` block inside `score_and_report_batch`. Replace:

```python
            except Exception as e:
                failed += 1
                logger.error("score_job_error", job_id=job.get("id"), error=str(e))
                try:
                    await mark_job_score_failed(pool, job["id"])
                except Exception:
                    pass
```

With:

```python
            except Exception as e:
                failed += 1
                logger.error("score_job_error", job_id=job.get("id"), error=str(e))
                try:
                    from agent.scoring_engine import _friendly_score_error
                    friendly = _friendly_score_error(e, job)
                    await mark_job_score_failed(pool, job["id"], error_message=friendly)
                except Exception:
                    pass
```

- [ ] **Step 5: Verify import**

```bash
cd agent
poetry run python -c "from agent.scoring_engine import _friendly_score_error; print('ok')"
```
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add agent/agent/db_sqlite.py agent/agent/db_pg.py agent/agent/scoring_engine.py agent/agent/graphs/scoring.py
git commit -m "feat: store user-friendly error reason on score_failed jobs"
```

---

### Task 3: TypeScript types + jobs API update

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/app/api/candidates/[id]/jobs/route.ts`

- [ ] **Step 1: Add `errorMessage` to `HitlJob` in `src/lib/api.ts`**

Find the `HitlJob` interface and add `errorMessage` after `emailCadence`:

```typescript
export interface HitlJob {
  id: string
  title: string
  company: string
  location: string | null
  source: string
  sourceUrl: string
  postedAt: string | null
  status: string
  grade: string | null
  numericScore: number | null
  score10d: Record<string, unknown> | null
  reportMd: string | null
  archetype: string | null
  archetypeConfidence: string | null
  hitlCheckpoint: HitlCheckpointSummary | null
  outreachTarget: OutreachTargetSummary | null
  emailCadence: EmailCadenceSummary | null
  errorMessage: string | null
}
```

- [ ] **Step 2: Add `retryScoring` function to `src/lib/api.ts`**

Add after the `resetFailedJobs` function:

```typescript
export async function retryScoring(
  jobId: string,
  candidateId: string,
): Promise<{ pipelineJobId: string; status: string }> {
  return request(`/api/jobs/${jobId}/retry-scoring${qs(candidateId)}`, { method: 'POST' })
}
```

- [ ] **Step 3: Update `src/app/api/candidates/[id]/jobs/route.ts`**

**3a.** Add `or` to the drizzle-orm import at the top of the file:
```typescript
import { and, eq, ne, notInArray, inArray, or } from 'drizzle-orm'
```

**3b.** Remove `'score_failed'` from `EXCLUDED_STATUSES`:
```typescript
const EXCLUDED_STATUSES: JobStatus[] = [
  'discovered', 'rejected',
  'approved', 'snoozed', 'submitted', 'resume_ready', 'resume_failed',
]
```

**3c.** Add `jobErrorMessage: jobs.errorMessage,` to the `.select({...})` block, after `archetypeConfidence`:
```typescript
        archetypeConfidence: jobs.archetypeConfidence,
        createdAt: jobs.createdAt,
        jobErrorMessage:     jobs.errorMessage,
```

**3d.** Fix the `.where(...)` clause to include `score_failed` jobs regardless of grade (they have `null` grade so `ne(grade, 'F')` would exclude them in SQL):

Replace:
```typescript
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          ne(jobs.grade, 'F'),
          notInArray(jobs.status, EXCLUDED_STATUSES)
        )
      )
```

With:
```typescript
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          or(
            eq(jobs.status, 'score_failed'),
            and(
              ne(jobs.grade, 'F'),
              notInArray(jobs.status, EXCLUDED_STATUSES)
            )
          )
        )
      )
```

**3e.** Add `errorMessage` to the mapped response object. Find the mapping block and add after `archetypeConfidence`:
```typescript
      archetypeConfidence: r.archetypeConfidence,
      createdAt:           r.createdAt,
      errorMessage:        r.jobErrorMessage ?? null,
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts "src/app/api/candidates/[id]/jobs/route.ts"
git commit -m "feat: include score_failed jobs in pipeline API with errorMessage"
```

---

### Task 4: `POST /api/jobs/[jobId]/retry-scoring` endpoint

**Files:**
- Create: `src/app/api/jobs/[jobId]/retry-scoring/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs } from '@/db/schema'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const url = new URL(_request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [job] = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    if (job.status !== 'score_failed') {
      return NextResponse.json(
        { error: `Job must be in score_failed status to retry (current: ${job.status})` },
        { status: 422 }
      )
    }

    // Reset the job so the scoring graph picks it up
    await db
      .update(jobs)
      .set({ status: 'discovered', errorMessage: null })
      .where(eq(jobs.id, jobId))

    // Queue a score_jobs run scoped to this single job
    const [pj] = await db
      .insert(pipelineJobs)
      .values({
        jobType:     'score_jobs',
        candidateId,
        payload:     { job_ids: [jobId], candidate_id: candidateId },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({ pipelineJobId: pj.id, status: 'queued' })
  } catch (e) {
    console.error('[retry-scoring] error:', e)
    return NextResponse.json({ error: 'Failed to retry scoring' }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/jobs/[jobId]/retry-scoring/route.ts"
git commit -m "feat: POST /api/jobs/[jobId]/retry-scoring — per-job score retry endpoint"
```

---

### Task 5: `ScoreFailedSection` component with tests

**Files:**
- Create: `src/components/pipeline/ScoreFailedSection.tsx`
- Create: `src/__tests__/components/ScoreFailedSection.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/components/ScoreFailedSection.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScoreFailedSection } from '@/components/pipeline/ScoreFailedSection'
import type { HitlJob } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  resetFailedJobs:  vi.fn().mockResolvedValue({ reset: 2 }),
  retryScoring:     vi.fn().mockResolvedValue({ pipelineJobId: 'pj1', status: 'queued' }),
  triggerPipeline:  vi.fn().mockResolvedValue({ jobId: 'pj2', status: 'queued' }),
}))

function makeJob(overrides: Partial<HitlJob> = {}): HitlJob {
  return {
    id: 'j1', title: 'Head of AI', company: 'Acme Corp',
    location: null, source: 'linkedin', sourceUrl: 'https://linkedin.com/jobs/view/123',
    postedAt: null, status: 'score_failed', grade: null, numericScore: null,
    score10d: null, reportMd: null, archetype: null, archetypeConfidence: null,
    hitlCheckpoint: null, outreachTarget: null, emailCadence: null,
    errorMessage: 'No job description found — try re-importing with a direct job URL',
    ...overrides,
  }
}

const baseProps = {
  jobs: [makeJob(), makeJob({ id: 'j2', title: 'CTO', errorMessage: 'Scoring failed unexpectedly — click Retry to try again' })],
  candidateId: 'cand1',
  onRetried: vi.fn(),
}

describe('ScoreFailedSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders header with correct count', () => {
    render(<ScoreFailedSection {...baseProps} />)
    expect(screen.getByText(/2 job/i)).toBeInTheDocument()
  })

  it('is collapsed by default — job rows not visible', () => {
    render(<ScoreFailedSection {...baseProps} />)
    expect(screen.queryByText('Head of AI')).not.toBeInTheDocument()
  })

  it('expands when header is clicked', () => {
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /job.*could not be scored/i }))
    expect(screen.getByText('Head of AI')).toBeInTheDocument()
    expect(screen.getByText('CTO')).toBeInTheDocument()
  })

  it('shows error reason for each job when expanded', () => {
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /job.*could not be scored/i }))
    expect(screen.getByText(/No job description found/)).toBeInTheDocument()
    expect(screen.getByText(/Scoring failed unexpectedly/)).toBeInTheDocument()
  })

  it('per-job Retry calls retryScoring and onRetried', async () => {
    const { retryScoring } = await import('@/lib/api')
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /job.*could not be scored/i }))
    const retryBtns = screen.getAllByRole('button', { name: /^retry$/i })
    fireEvent.click(retryBtns[0])
    await waitFor(() => expect(retryScoring).toHaveBeenCalledWith('j1', 'cand1'))
    expect(baseProps.onRetried).toHaveBeenCalledWith('pj1')
  })

  it('Retry All calls resetFailedJobs + triggerPipeline then onRetried', async () => {
    const { resetFailedJobs, triggerPipeline } = await import('@/lib/api')
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /retry all/i }))
    await waitFor(() => expect(resetFailedJobs).toHaveBeenCalledWith('cand1'))
    expect(triggerPipeline).toHaveBeenCalledWith('score_jobs', 'cand1')
    expect(baseProps.onRetried).toHaveBeenCalledWith('pj2')
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run "src/__tests__/components/ScoreFailedSection.test.tsx"
```
Expected: FAIL — `ScoreFailedSection` not found.

- [ ] **Step 3: Create the component**

Create `src/components/pipeline/ScoreFailedSection.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resetFailedJobs, retryScoring, triggerPipeline } from '@/lib/api'
import type { HitlJob } from '@/lib/api'

interface Props {
  jobs: HitlJob[]
  candidateId: string
  onRetried: (pipelineJobId: string) => void
}

export function ScoreFailedSection({ jobs, candidateId, onRetried }: Props) {
  const [open, setOpen]                   = useState(false)
  const [retryingAll, setRetryingAll]     = useState(false)
  const [retryingId, setRetryingId]       = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const count = jobs.length

  async function handleRetryAll() {
    setRetryingAll(true)
    setError(null)
    try {
      await resetFailedJobs(candidateId)
      const { jobId } = await triggerPipeline('score_jobs', candidateId)
      onRetried(jobId)
    } catch {
      setError('Failed to retry — please try again')
    } finally {
      setRetryingAll(false)
    }
  }

  async function handleRetryOne(jobId: string) {
    setRetryingId(jobId)
    setError(null)
    try {
      const { pipelineJobId } = await retryScoring(jobId, candidateId)
      onRetried(pipelineJobId)
    } catch {
      setError('Failed to retry — please try again')
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="max-w-3xl mt-4 border border-amber-800/40 rounded-xl overflow-hidden bg-[#0d1829]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-950/20">
        <Button
          variant="ghost"
          className="flex items-center gap-2 h-auto p-0 text-amber-400 hover:text-amber-300 hover:bg-transparent"
          onClick={() => setOpen(v => !v)}
          aria-label={`${count} job${count !== 1 ? 's' : ''} could not be scored`}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[12px] font-semibold">
            {count} job{count !== 1 ? 's' : ''} could not be scored
          </span>
          {open
            ? <ChevronUp className="w-3.5 h-3.5 ml-1" />
            : <ChevronDown className="w-3.5 h-3.5 ml-1" />
          }
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] border-amber-700/50 text-amber-400 hover:bg-amber-950/40 gap-1"
          onClick={handleRetryAll}
          disabled={retryingAll}
          isLoading={retryingAll}
          aria-label="Retry All"
        >
          <RotateCcw className="w-3 h-3" />
          Retry All
        </Button>
      </div>

      {/* Body */}
      {open && (
        <div className="divide-y divide-[#1e2d4a]">
          {jobs.map(job => (
            <div key={job.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-[#e2e8f0] truncate">
                    {job.title}
                  </span>
                  <span className="text-[11px] text-[#475569] shrink-0">
                    · {job.company}
                  </span>
                  <a
                    href={job.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#475569] hover:text-[#93c5fd] shrink-0"
                    title="Open original job listing"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {job.errorMessage && (
                  <p className="text-[11px] text-amber-600/80 mt-0.5">{job.errorMessage}</p>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1 shrink-0"
                onClick={() => handleRetryOne(job.id)}
                disabled={retryingId === job.id}
                isLoading={retryingId === job.id}
                aria-label="Retry"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="px-4 py-2 text-[10px] text-red-400 border-t border-[#1e2d4a]">{error}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run "src/__tests__/components/ScoreFailedSection.test.tsx"
```
Expected: all 6 tests PASS. If any fail, fix the component (not the tests).

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/ScoreFailedSection.tsx "src/__tests__/components/ScoreFailedSection.test.tsx"
git commit -m "feat: ScoreFailedSection component — collapsible failed-jobs strip with per-job retry"
```

---

### Task 6: Wire `ScoreFailedSection` into the Pipeline page

**Files:**
- Modify: `src/app/candidates/[id]/pipeline/page.tsx`

- [ ] **Step 1: Add import**

At the top of `src/app/candidates/[id]/pipeline/page.tsx`, add:

```typescript
import { ScoreFailedSection } from '@/components/pipeline/ScoreFailedSection'
```

- [ ] **Step 2: Add `retryJobIds` state**

After the existing `resumeBuilderJobIds` state declaration, add:

```typescript
const [retryJobIds, setRetryJobIds] = useState<string[]>([])
```

- [ ] **Step 3: Split scored vs failed jobs**

In the render section, just before the `jobs.length === 0` empty-state check, add a derived split:

```typescript
const scoredJobs = jobs.filter(j => j.status !== 'score_failed')
const failedJobs = jobs.filter(j => j.status === 'score_failed')
```

Replace `jobs.map(job => (...))` with `scoredJobs.map(job => (...))` in the job list render.

Replace the `jobs.length === 0` empty state check with `scoredJobs.length === 0` so the empty state only shows when there are also no failed jobs, or keep it simple — show empty state when `scoredJobs.length === 0 && failedJobs.length === 0`.

The full updated job list section:

```tsx
        ) : scoredJobs.length === 0 && failedJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <Workflow className="w-10 h-10 text-[#1e2d4a] mb-4" />
            <p className="text-[13px] text-[#64748b] mb-4">
              No matching jobs — try a wider filter or run the pipeline
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] border-[#1e2d4a] text-[#64748b] hover:text-[#94a3b8]"
              onClick={() => router.push(`/candidates/${candidateId}/dashboard`)}
            >
              Run Pipeline →
            </Button>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {scoredJobs.map(job => (
              <JobReviewCard
                key={job.id}
                job={job}
                candidateId={candidateId}
                onApprove={handleApprove}
                onReject={handleReject}
                onSnooze={handleSnooze}
                onUnsnooze={handleUnsnooze}
                onGenerateResume={handleGenerateResume}
                isPending={pendingJobIds.has(job.id)}
                onUpdate={() => loadJobs(selectedGrades, sort)}
              />
            ))}
          </div>
        )}
```

- [ ] **Step 4: Render `ScoreFailedSection` and updated log pane**

After the closing `)}` of the job list section, and before the existing `resumeBuilderJobIds` log pane block, add:

```tsx
        {failedJobs.length > 0 && (
          <ScoreFailedSection
            jobs={failedJobs}
            candidateId={candidateId}
            onRetried={(pjId) => {
              setRetryJobIds(prev => [...prev, pjId])
              loadJobs(selectedGrades, sort)
            }}
          />
        )}
```

Update the log pane to also include `retryJobIds`:

```tsx
        {(resumeBuilderJobIds.length > 0 || retryJobIds.length > 0) && (
          <div ref={logPaneRef} className="max-w-3xl mt-6">
            <PipelineLogPane chainJobIds={[...resumeBuilderJobIds, ...retryJobIds]} />
          </div>
        )}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 6: Full test run**

```bash
npm run test:run
```
Expected: 0 new failures.

- [ ] **Step 7: Commit**

```bash
git add "src/app/candidates/[id]/pipeline/page.tsx"
git commit -m "feat: show score_failed jobs in Pipeline page with ScoreFailedSection"
```

---

### Task 7: Final verification

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 2: Test run**

```bash
npm run test:run
```
Expected: 0 failures.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: exit 0, no prerender errors.

- [ ] **Step 4: Smoke test**

1. Start dev server: `npm run dev`
2. Import a LinkedIn alert URL → job imports, scores → if it fails (empty JD), daemon marks it `score_failed` with the friendly message
3. Go to Pipeline page → "Failed to Score" amber strip appears at the bottom
4. Expand it → see job title, company, friendly error reason, Retry button
5. Click Retry on a job → strip collapses that row, Pipeline Log Pane appears and shows scoring progress
6. Click Retry All → all failed jobs reset, scoring runs for all of them

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: score failure visibility — friendly errors, Pipeline section, per-job retry"
```
