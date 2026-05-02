# Rescore Failed Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard button that resets `score_failed` jobs to `discovered` and appends per-job error reasons to the pipeline log pane.

**Architecture:** Three independent layers — a Python one-liner fix in the scoring agent, two new Next.js API routes (`GET /api/jobs/stats`, `POST /api/jobs/reset-failed`), and a conditional button in the dashboard that calls them. No new DB schema changes.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, TypeScript, Tailwind CSS, Python (structlog)

---

## File Map

| Action | File |
|--------|------|
| Modify | `agent/agent/graphs/scoring.py` — inline actual error in log message |
| Create | `src/app/api/jobs/stats/route.ts` — GET count of score_failed jobs |
| Create | `src/app/api/jobs/reset-failed/route.ts` — POST reset + append pipeline logs |
| Modify | `src/lib/api.ts` — add `getJobStats()` and `resetFailedJobs()` client functions |
| Modify | `src/app/dashboard/page.tsx` — add `scoreFailed` state + "Rescore Failed" button |

---

## Task 1: Fix scoring log message to include actual error inline

**Files:**
- Modify: `agent/agent/graphs/scoring.py:157-161`

- [ ] **Step 1: Open `agent/agent/graphs/scoring.py` and locate the except block (lines 150-161)**

The current log message at line 160:
```python
reason = "rate limit — re-run score_jobs to retry" if is_rate_limit else "LLM error — marked score_failed"
await _log(pool, state.pipeline_job_id, "warning", "score_and_report_batch",
           f"Skipped: {job.get('title')} @ {job.get('company')} ({reason})",
           {"job_id": job.get("id"), "error": str(e)})
```

- [ ] **Step 2: Replace lines 157-161 with the version that includes the actual error inline**

```python
is_rate_limit = "rate" in str(e).lower() or "429" in str(e)
short_error = str(e)[:120]
if is_rate_limit:
    log_msg = f"Skipped: {job.get('title')} @ {job.get('company')} — rate limit (re-run score_jobs to retry)"
else:
    log_msg = f"Skipped: {job.get('title')} @ {job.get('company')} — {short_error} (marked score_failed)"
await _log(pool, state.pipeline_job_id, "warning", "score_and_report_batch",
           log_msg,
           {"job_id": job.get("id"), "error": str(e)})
```

- [ ] **Step 3: Commit**

```bash
git add agent/agent/graphs/scoring.py
git commit -m "fix: include actual error text inline in score_failed pipeline log message"
```

---

## Task 2: Create `GET /api/jobs/stats` route

**Files:**
- Create: `src/app/api/jobs/stats/route.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/api/jobs/stats.test.ts` (create file):

```typescript
import { GET } from '@/app/api/jobs/stats/route'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: '3' }]),
  },
}))

describe('GET /api/jobs/stats', () => {
  it('returns scoreFailed count', async () => {
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ scoreFailed: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/api/jobs/stats.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/app/api/jobs/stats/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

export async function GET() {
  try {
    const [row] = await db
      .select({ count: sql<string>`count(*)` })
      .from(jobs)
      .where(eq(jobs.status, 'score_failed'))

    return NextResponse.json({ scoreFailed: Number(row?.count ?? 0) })
  } catch (e) {
    console.error('[jobs/stats] error:', e)
    return NextResponse.json({ scoreFailed: 0 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/api/jobs/stats.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/stats/route.ts src/__tests__/api/jobs/stats.test.ts
git commit -m "feat: GET /api/jobs/stats returns score_failed count"
```

---

## Task 3: Create `POST /api/jobs/reset-failed` route

**Files:**
- Create: `src/app/api/jobs/reset-failed/route.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/api/jobs/reset-failed.test.ts`:

```typescript
import { POST } from '@/app/api/jobs/reset-failed/route'

const mockJobs = [
  { id: 'job-1', title: 'Director AI', company: 'Acme' },
  { id: 'job-2', title: 'VP Engineering', company: 'Beta' },
]

const mockLogs = [
  { data: { job_id: 'job-1', error: 'JSON parse error' } },
]

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([]),
}

vi.mock('@/db', () => ({ db: mockDb }))

describe('POST /api/jobs/reset-failed', () => {
  it('returns reset count 0 when no score_failed jobs exist', async () => {
    mockDb.where.mockResolvedValueOnce([]) // no score_failed jobs
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ reset: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/api/jobs/reset-failed.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/app/api/jobs/reset-failed/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs, pipelineLogs } from '@/db/schema'

export async function POST() {
  try {
    // 1. Find all score_failed jobs
    const failedJobs = await db
      .select({ id: jobs.id, title: jobs.title, company: jobs.company })
      .from(jobs)
      .where(eq(jobs.status, 'score_failed'))

    if (failedJobs.length === 0) {
      return NextResponse.json({ reset: 0 })
    }

    const failedIds = failedJobs.map((j) => j.id)

    // 2. For each failed job, find most recent warning log with matching job_id in data
    const errorReasons = new Map<string, string>()
    for (const job of failedJobs) {
      const [logEntry] = await db
        .select({ data: pipelineLogs.data })
        .from(pipelineLogs)
        .where(
          and(
            eq(pipelineLogs.level, 'warning'),
            sql`${pipelineLogs.data}->>'job_id' = ${job.id}`
          )
        )
        .orderBy(desc(pipelineLogs.createdAt))
        .limit(1)

      const reason = (logEntry?.data?.error as string | undefined)?.slice(0, 120) ?? 'unknown error'
      errorReasons.set(job.id, reason)
    }

    // 3. Reset all score_failed → discovered
    await db
      .update(jobs)
      .set({ status: 'discovered' })
      .where(inArray(jobs.id, failedIds))

    // 4. Find most recent score_jobs pipeline job to append logs to
    const [scoreJob] = await db
      .select({ id: pipelineJobs.id })
      .from(pipelineJobs)
      .where(eq(pipelineJobs.jobType, 'score_jobs'))
      .orderBy(desc(pipelineJobs.createdAt))
      .limit(1)

    if (scoreJob) {
      // 5. Insert one log entry per failed job
      const perJobEntries = failedJobs.map((job) => ({
        pipelineJobId: scoreJob.id,
        level: 'info',
        step: 'reset_failed',
        message: `Reset: ${job.title} @ ${job.company} — ${errorReasons.get(job.id)}`,
        data: { job_id: job.id } as Record<string, unknown>,
      }))

      // 6. Insert summary entry
      const summaryEntry = {
        pipelineJobId: scoreJob.id,
        level: 'info',
        step: 'reset_failed',
        message: `Reset ${failedJobs.length} failed jobs — ready to rescore`,
        data: { count: failedJobs.length } as Record<string, unknown>,
      }

      try {
        await db.insert(pipelineLogs).values([...perJobEntries, summaryEntry])
      } catch {
        // Log insert failure is non-fatal — reset still succeeded
      }
    }

    return NextResponse.json({ reset: failedJobs.length })
  } catch (e) {
    console.error('[jobs/reset-failed] error:', e)
    return NextResponse.json({ error: 'Failed to reset jobs' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/api/jobs/reset-failed.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/reset-failed/route.ts src/__tests__/api/jobs/reset-failed.test.ts
git commit -m "feat: POST /api/jobs/reset-failed resets score_failed jobs and appends pipeline log entries"
```

---

## Task 4: Add API client functions

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Append two functions to `src/lib/api.ts`**

```typescript
export async function getJobStats(): Promise<{ scoreFailed: number }> {
  try {
    return await request('/api/jobs/stats')
  } catch {
    return { scoreFailed: 0 }
  }
}

export async function resetFailedJobs(): Promise<{ reset: number }> {
  return request('/api/jobs/reset-failed', { method: 'POST' })
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output (zero errors)

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add getJobStats and resetFailedJobs API client functions"
```

---

## Task 5: Add "Rescore Failed" button to dashboard

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add imports and state to the dashboard**

At the top of `page.tsx`, add `getJobStats` and `resetFailedJobs` to the import from `@/lib/api`:

```typescript
import { getCV, getReadiness, triggerPipeline, getPipelineStatus, getJobStats, resetFailedJobs } from '@/lib/api'
```

Add two new state variables inside `DashboardPage()`, after the existing state declarations:

```typescript
const [scoreFailed, setScoreFailed] = useState(0)
const [rescoreLoading, setRescoreLoading] = useState(false)
```

- [ ] **Step 2: Fetch `scoreFailed` on mount**

Inside the existing `load()` function in `useEffect`, add `getJobStats()` to the `Promise.all`:

```typescript
const [cv, r, stats] = await Promise.all([getCV(), getReadiness(), getJobStats()])
setCandidate(cv)
setReadiness(r)
setScoreFailed(stats.scoreFailed)
setLoading(false)
```

- [ ] **Step 3: Add the `handleRescore` handler**

After `handleRunPipeline`, add:

```typescript
async function handleRescore() {
  setRescoreLoading(true)
  try {
    const { reset } = await resetFailedJobs()
    setScoreFailed(0)
    setError(null)
    // Refresh pipeline log pane by re-fetching stats (jobs are now discovered)
    alert(`${reset} job${reset !== 1 ? 's' : ''} reset — trigger Score Jobs to rescore`)
  } catch {
    setError('Failed to reset failed jobs. Please try again.')
  } finally {
    setRescoreLoading(false)
  }
}
```

- [ ] **Step 4: Render the button in the Topbar actions**

In the `actions` prop of `<Topbar>`, add the "Rescore Failed" button after the existing pipeline run div:

```tsx
actions={
  <div className="flex items-center gap-2">
    {scoreFailed > 0 && (
      <Button
        size="sm"
        variant="outline"
        className="text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
        onClick={handleRescore}
        isLoading={rescoreLoading}
      >
        ⚠ Rescore Failed ({scoreFailed})
      </Button>
    )}
    <div className="relative flex items-center gap-0" ref={phaseMenuRef}>
      {/* existing run button and chevron unchanged */}
      ...
    </div>
  </div>
}
```

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: add Rescore Failed button to dashboard — visible only when score_failed jobs exist"
```

---

## Task 6: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: In SQLite, manually mark a job as score_failed to test button visibility**

```bash
python -c "
import sqlite3
conn = sqlite3.connect('proxim-dev.db')
conn.execute(\"UPDATE jobs SET status = 'score_failed' WHERE id = (SELECT id FROM jobs LIMIT 1)\")
conn.commit()
conn.close()
print('Done')
"
```

- [ ] **Step 3: Load the dashboard at http://localhost:3000**

Expected: "⚠ Rescore Failed (1)" button appears in the Topbar

- [ ] **Step 4: Click the button**

Expected:
- Alert/toast shows "1 job reset — trigger Score Jobs to rescore"
- Button disappears from Topbar
- In SQLite, that job's status is back to `discovered`

```bash
python -c "
import sqlite3
conn = sqlite3.connect('proxim-dev.db')
cur = conn.execute(\"SELECT status FROM jobs LIMIT 1\")
print(cur.fetchone())
conn.close()
"
```

Expected output: `('discovered',)`

- [ ] **Step 5: Run full verification gate**

```bash
npm run test:run
npx tsc --noEmit
npm run build
```

All three must pass with zero errors before this task is complete.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: smoke test corrections for rescore-failed button"
```
