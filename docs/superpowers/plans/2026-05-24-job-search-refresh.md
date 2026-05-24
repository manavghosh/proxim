# Job Search Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-service Job Search card to the dashboard that lets candidates re-trigger job discovery and re-scoring with live progress tracking, replacing the buried developer-centric split button in the topbar.

**Architecture:** New `GET /api/candidates/[id]/last-search` endpoint reads `pipeline_runs` joined with `pipeline_jobs` for discovery stats. A new `JobSearchCard` component manages its own run state — it calls `triggerPipeline()`, polls `getPipelineStatus()` following the `followUpJobId` chain, and drives a P1 step tracker (Discover → Fetch JDs → Score). The split button in the topbar is removed; its functionality moves entirely into the card.

**Tech Stack:** Next.js App Router, Drizzle ORM (Postgres/SQLite via `@/db`), shadcn/ui + Tailwind CSS v4, Vitest + Testing Library

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/app/api/jobs/stats/route.ts` | Modify | Add `awaitingReview` to stats response |
| `src/app/api/candidates/[id]/last-search/route.ts` | Create | GET handler for last discovery run metadata |
| `src/lib/api.ts` | Modify | Add `LastSearch` type, `getLastSearch()`, `awaitingReview` to stats type, `createdAt` to `HitlJob` |
| `src/components/dashboard/JobSearchCard.tsx` | Create | Full card with idle / running / complete / error states |
| `src/app/candidates/[id]/dashboard/page.tsx` | Modify | Remove split button; fetch last-search; render JobSearchCard |
| `src/components/pipeline/JobReviewCard.tsx` | Modify | Add "New" pill for jobs created within 24 h |
| `src/app/candidates/[id]/pipeline/page.tsx` | Modify | Change empty-state button text |
| `src/components/dashboard/PipelineLogPane.tsx` | Modify | Change placeholder text |
| `src/__tests__/components/dashboard/JobSearchCard.test.tsx` | Create | Tests for idle states, staleness, soft cooldown |

---

## Task 1: Extend job stats — add `awaitingReview`

**Files:**
- Modify: `src/app/api/jobs/stats/route.ts`
- Modify: `src/lib/api.ts:183`

- [ ] **Step 1: Update the stats route to return `awaitingReview`**

In `src/app/api/jobs/stats/route.ts`, add `awaitingReview` to the return value. `scored` and `awaiting` status jobs are the ones waiting for a human pipeline decision:

```ts
// After the existing scoreFailed / jobsMatched / applications derivations, add:
const awaitingReview = (counts['scored'] ?? 0) + (counts['awaiting'] ?? 0)

return NextResponse.json({ scoreFailed, jobsMatched, applications, awaitingReview })
```

- [ ] **Step 2: Update the `getJobStats` return type in api.ts**

In `src/lib/api.ts` at the `getJobStats` function (line ~183), update the return type:

```ts
export async function getJobStats(candidateId: string): Promise<{
  scoreFailed: number
  jobsMatched: number
  applications: number
  awaitingReview: number
}> {
  try {
    return await request(`/api/jobs/stats${qs(candidateId)}`)
  } catch {
    return { scoreFailed: 0, jobsMatched: 0, applications: 0, awaitingReview: 0 }
  }
}
```

- [ ] **Step 3: Run TypeScript check to confirm no type errors**

```bash
npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/stats/route.ts src/lib/api.ts
git commit -m "feat: add awaitingReview to job stats endpoint"
```

---

## Task 2: New API endpoint — GET /api/candidates/[id]/last-search

**Files:**
- Create: `src/app/api/candidates/[id]/last-search/route.ts`

- [ ] **Step 1: Create the route file**

```ts
import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs, pipelineRuns } from '@/db/schema'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params

    const rows = await db
      .select({
        completedAt: pipelineRuns.completedAt,
        jobsDiscovered: pipelineRuns.jobsDiscovered,
        jobsDeduplicated: pipelineRuns.jobsDeduplicated,
      })
      .from(pipelineRuns)
      .innerJoin(pipelineJobs, eq(pipelineRuns.pipelineJobId, pipelineJobs.id))
      .where(
        and(
          eq(pipelineJobs.candidateId, candidateId),
          eq(pipelineJobs.jobType, 'discovery_only'),
          eq(pipelineRuns.status, 'completed'),
        )
      )
      .orderBy(desc(pipelineRuns.completedAt))
      .limit(1)

    if (rows.length === 0) {
      return NextResponse.json({
        lastSearchAt: null,
        jobsDiscovered: null,
        newJobs: null,
        duplicatesSkipped: null,
      })
    }

    const run = rows[0]
    const lastSearchAt = run.completedAt ? String(run.completedAt) : null
    const jobsDiscovered = run.jobsDiscovered
    const duplicatesSkipped = run.jobsDeduplicated
    const newJobs = Math.max(0, jobsDiscovered - duplicatesSkipped)

    return NextResponse.json({ lastSearchAt, jobsDiscovered, newJobs, duplicatesSkipped })
  } catch (e) {
    console.error('[last-search] error:', e)
    return NextResponse.json(
      { error: 'Failed to load last search data' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Smoke test the endpoint manually**

Start the dev server (`npm run dev`) and open:
```
http://localhost:3000/api/candidates/<your-candidate-id>/last-search
```

Expected: JSON with `lastSearchAt`, `jobsDiscovered`, `newJobs`, `duplicatesSkipped` (may all be null if no discovery run has completed yet).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/candidates/[id]/last-search/route.ts
git commit -m "feat: add GET /api/candidates/[id]/last-search endpoint"
```

---

## Task 3: Add client types and functions to api.ts

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add `LastSearch` interface and `getLastSearch()` function**

After the `getJobStats` function, add:

```ts
// ── Last Search ───────────────────────────────────────────────────────────────

export interface LastSearch {
  lastSearchAt: string | null
  jobsDiscovered: number | null
  newJobs: number | null
  duplicatesSkipped: number | null
}

export async function getLastSearch(candidateId: string): Promise<LastSearch> {
  try {
    return await request(`/api/candidates/${candidateId}/last-search`)
  } catch {
    return { lastSearchAt: null, jobsDiscovered: null, newJobs: null, duplicatesSkipped: null }
  }
}
```

- [ ] **Step 2: Add `createdAt` to `HitlJob` interface**

The jobs API route already returns `createdAt` in the response but the TypeScript type is missing it. In the `HitlJob` interface (around line 290), add the field:

```ts
export interface HitlJob {
  id: string
  title: string
  company: string
  location: string | null
  source: string
  sourceUrl: string
  postedAt: string | null
  createdAt: string          // ← add this line
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

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add getLastSearch, LastSearch type, and createdAt to HitlJob"
```

---

## Task 4: Build JobSearchCard — idle state + staleness logic

**Files:**
- Create: `src/components/dashboard/JobSearchCard.tsx`
- Create: `src/__tests__/components/dashboard/JobSearchCard.test.tsx`

- [ ] **Step 1: Write the failing tests first**

Create `src/__tests__/components/dashboard/JobSearchCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { JobSearchCard } from '@/components/dashboard/JobSearchCard'

// Mock api module — the card imports triggerPipeline and getPipelineStatus
vi.mock('@/lib/api', () => ({
  triggerPipeline: vi.fn(),
  getPipelineStatus: vi.fn(),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const CANDIDATE_ID = 'test-candidate-id'

function makeLastSearch(overrides: Partial<{
  lastSearchAt: string | null
  jobsDiscovered: number | null
  newJobs: number | null
  duplicatesSkipped: number | null
}> = {}) {
  return {
    lastSearchAt: '2026-05-16T09:00:00Z',
    jobsDiscovered: 47,
    newJobs: 12,
    duplicatesSkipped: 35,
    ...overrides,
  }
}

describe('JobSearchCard — idle state', () => {
  it('renders "Search for New Jobs" and "Re-score All" buttons', () => {
    render(
      <JobSearchCard
        candidateId={CANDIDATE_ID}
        lastSearch={makeLastSearch()}
        awaitingReview={9}
        scoreFailed={2}
        onSearchComplete={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /search for new jobs/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-score all/i })).toBeInTheDocument()
  })

  it('shows soft cooldown note when last search was within 6 hours', () => {
    const recentAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago
    render(
      <JobSearchCard
        candidateId={CANDIDATE_ID}
        lastSearch={makeLastSearch({ lastSearchAt: recentAt })}
        awaitingReview={0}
        scoreFailed={0}
        onSearchComplete={vi.fn()}
      />
    )
    expect(screen.getByText(/results may be similar/i)).toBeInTheDocument()
  })

  it('does NOT show cooldown note when last search was 8 hours ago', () => {
    const olderAt = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
    render(
      <JobSearchCard
        candidateId={CANDIDATE_ID}
        lastSearch={makeLastSearch({ lastSearchAt: olderAt })}
        awaitingReview={0}
        scoreFailed={0}
        onSearchComplete={vi.fn()}
      />
    )
    expect(screen.queryByText(/results may be similar/i)).not.toBeInTheDocument()
  })

  it('shows stale badge when last search was more than 7 days ago', () => {
    const staleAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    render(
      <JobSearchCard
        candidateId={CANDIDATE_ID}
        lastSearch={makeLastSearch({ lastSearchAt: staleAt })}
        awaitingReview={0}
        scoreFailed={0}
        onSearchComplete={vi.fn()}
      />
    )
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
  })

  it('shows "No searches yet" hint when lastSearch is null', () => {
    render(
      <JobSearchCard
        candidateId={CANDIDATE_ID}
        lastSearch={null}
        awaitingReview={0}
        scoreFailed={0}
        onSearchComplete={vi.fn()}
      />
    )
    expect(screen.getByText(/no searches yet/i)).toBeInTheDocument()
  })

  it('renders stats row with last-run numbers', () => {
    render(
      <JobSearchCard
        candidateId={CANDIDATE_ID}
        lastSearch={makeLastSearch({ jobsDiscovered: 47, newJobs: 12 })}
        awaitingReview={9}
        scoreFailed={2}
        onSearchComplete={vi.fn()}
      />
    )
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('+12 new')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument() // awaitingReview
    expect(screen.getByText('2')).toBeInTheDocument() // scoreFailed
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/components/dashboard/JobSearchCard.test.tsx
```

Expected: FAIL — `JobSearchCard` not found.

- [ ] **Step 3: Create the component with idle state**

Create `src/components/dashboard/JobSearchCard.tsx`:

```tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { triggerPipeline, getPipelineStatus } from '@/lib/api'
import type { LastSearch } from '@/lib/api'

export interface JobSearchCardProps {
  candidateId: string
  lastSearch: LastSearch | null
  awaitingReview: number
  scoreFailed: number
  onSearchComplete: () => void
}

type CardMode = 'idle' | 'running' | 'complete' | 'error'
type StepStatus = 'pending' | 'active' | 'done'

interface StepState {
  label: string
  status: StepStatus
  count: string
}

interface CompletionData {
  newJobs: number
  jobsDiscovered: number
  duplicatesSkipped: number
}

const STEP_INIT: StepState[] = [
  { label: 'Discover',  status: 'pending', count: '' },
  { label: 'Fetch JDs', status: 'pending', count: '' },
  { label: 'Score',     status: 'pending', count: '' },
]

const JOB_TYPE_TO_STEP: Record<string, number> = {
  discovery_only: 0,
  fetch_jds:      1,
  score_jobs:     2,
}

// ── Staleness helpers ────────────────────────────────────────────────────────

function getHoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60)
}

function formatLastSearched(lastSearchAt: string | null): string {
  if (!lastSearchAt) return 'No searches yet'
  const hours = getHoursSince(lastSearchAt)
  const minutes = Math.round(hours * 60)
  if (minutes < 60) return `Last searched ${minutes}m ago`
  const h = Math.floor(hours)
  if (h < 24) return `Last searched ${h}h ago`
  const days = Math.floor(h / 24)
  if (days === 1) return 'Last searched yesterday'
  return `Last searched ${days} days ago`
}

function getStaleBadge(lastSearchAt: string | null): string | null {
  if (!lastSearchAt) return null
  const days = getHoursSince(lastSearchAt) / 24
  if (days > 7) return `⚠ Stale · ${Math.floor(days)}d`
  return null
}

function getSoftCooldownNote(lastSearchAt: string | null): string | null {
  if (!lastSearchAt) return null
  const hours = getHoursSince(lastSearchAt)
  if (hours >= 6) return null
  const h = Math.floor(hours)
  return `Searched ${h}h ago · results may be similar`
}

// ── Main component ───────────────────────────────────────────────────────────

export function JobSearchCard({
  candidateId,
  lastSearch,
  awaitingReview,
  scoreFailed,
  onSearchComplete,
}: JobSearchCardProps) {
  const router = useRouter()
  const [mode, setMode]               = useState<CardMode>('idle')
  const [steps, setSteps]             = useState<StepState[]>(STEP_INIT)
  const [completion, setCompletion]   = useState<CompletionData | null>(null)
  const [errorMsg, setErrorMsg]       = useState<string>('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [rescoreLoading, setRescoreLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const staleBadge  = getStaleBadge(lastSearch?.lastSearchAt ?? null)
  const cooldownNote = getSoftCooldownNote(lastSearch?.lastSearchAt ?? null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
  }, [])

  // Auto-dismiss complete state after 8 seconds
  useEffect(() => {
    if (mode !== 'complete') return
    const t = setTimeout(() => {
      setMode('idle')
      setCompletion(null)
    }, 8000)
    return () => clearTimeout(t)
  }, [mode])

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling])

  function startStepsForJobType(jobType: string): StepState[] {
    const activeIdx = JOB_TYPE_TO_STEP[jobType] ?? 0
    return STEP_INIT.map((s, i) => ({
      ...s,
      status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
    }))
  }

  function poll(jobId: string, rescoreOnly: boolean) {
    pollRef.current = setTimeout(async () => {
      try {
        const status = await getPipelineStatus(jobId)
        const stepIdx = JOB_TYPE_TO_STEP[status.jobType] ?? 0

        // Update step counts from pipelineRun data
        const discovered = status.pipelineRun?.jobsDiscovered ?? 0
        const deduped    = status.pipelineRun?.jobsDeduplicated ?? 0

        setSteps(prev => prev.map((s, i) => {
          if (i < stepIdx) return { ...s, status: 'done' }
          if (i === stepIdx) {
            const count = stepIdx === 0
              ? discovered > 0 ? `${discovered} found` : 'Searching…'
              : 'Running…'
            return { ...s, status: 'active', count }
          }
          return { ...s, status: 'pending', count: 'Waiting…' }
        }))

        if (status.followUpJobId) {
          const nextIdx = JOB_TYPE_TO_STEP[status.jobType] ?? 0
          setSteps(prev => prev.map((s, i) => ({
            ...s,
            status: i <= nextIdx ? 'done' : i === nextIdx + 1 ? 'active' : 'pending',
            count: i === 0 ? `${discovered} found` : i === nextIdx + 1 ? 'Running…' : 'Waiting…',
          })))
          poll(status.followUpJobId, rescoreOnly)
        } else if (status.status === 'completed') {
          setSteps(STEP_INIT.map((s, i) =>
            rescoreOnly ? (i === 2 ? { ...s, status: 'done', count: 'Done' } : s)
                        : { ...s, status: 'done', count: i === 0 ? `${discovered} found` : 'Done' }
          ))
          setCompletion({
            newJobs:          Math.max(0, discovered - deduped),
            jobsDiscovered:   discovered,
            duplicatesSkipped: deduped,
          })
          setMode('complete')
          onSearchComplete()
          stopPolling()
        } else if (status.status === 'failed') {
          setErrorMsg('Pipeline failed. Check the AI agent is running.')
          setMode('error')
          stopPolling()
        } else {
          poll(jobId, rescoreOnly)
        }
      } catch {
        poll(jobId, rescoreOnly)
      }
    }, 5000)
  }

  async function handleSearch() {
    setSearchLoading(true)
    setErrorMsg('')
    try {
      const { jobId } = await triggerPipeline('discovery_only', candidateId)
      setSteps(startStepsForJobType('discovery_only'))
      setMode('running')
      poll(jobId, false)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to start search.')
      setMode('error')
    } finally {
      setSearchLoading(false)
    }
  }

  async function handleRescore() {
    setRescoreLoading(true)
    setErrorMsg('')
    try {
      const { jobId } = await triggerPipeline('score_jobs', candidateId)
      setSteps(startStepsForJobType('score_jobs'))
      setMode('running')
      poll(jobId, true)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to start scoring.')
      setMode('error')
    } finally {
      setRescoreLoading(false)
    }
  }

  function handleCancel() {
    stopPolling()
    setSteps(STEP_INIT)
    setMode('idle')
  }

  // ── Render: Running ──────────────────────────────────────────────────────
  if (mode === 'running') {
    return (
      <Card className="bg-[#0a1628] border-[#2563eb] mb-5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[9px] font-bold tracking-widest text-blue-300 uppercase">Job Search</p>
              <p className="text-[13px] font-semibold text-slate-100 mt-0.5">Searching for new jobs…</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[9px] text-blue-300">Running</span>
            </div>
          </div>
          <div className="flex gap-1.5 mb-3">
            {steps.map((step) => (
              <div
                key={step.label}
                className={`flex-1 rounded-md px-2 py-1.5 border text-[10px] transition-all ${
                  step.status === 'done'
                    ? 'border-emerald-500 bg-[#0d1f3c]'
                    : step.status === 'active'
                      ? 'border-blue-500 bg-[#0d1f3c]'
                      : 'border-[#1e2d4a] bg-[#0d1f3c] opacity-50'
                }`}
              >
                <div className={`font-semibold ${
                  step.status === 'done' ? 'text-emerald-400' : step.status === 'active' ? 'text-blue-300' : 'text-slate-500'
                }`}>
                  {step.status === 'done' ? '✓' : step.status === 'active' ? '⟳' : '◯'} {step.label}
                </div>
                <div className="text-slate-500 text-[9px] mt-0.5">{step.count || (step.status === 'active' ? 'Running…' : 'Waiting…')}</div>
              </div>
            ))}
          </div>
          <div className="text-right">
            <button
              onClick={handleCancel}
              className="text-[9px] text-slate-500 border-b border-slate-700 hover:text-slate-400"
            >
              Cancel
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Render: Complete (C1) ────────────────────────────────────────────────
  if (mode === 'complete' && completion) {
    return (
      <Card className="bg-[#0a1628] border-emerald-500 mb-5">
        <CardContent className="p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-emerald-400 text-sm">✓</span>
            <span className="text-[12px] font-semibold text-slate-100">Search complete</span>
          </div>
          <div className="flex gap-1.5 mb-3">
            {[
              { label: 'new jobs',          value: completion.newJobs,           color: 'text-emerald-400' },
              { label: 'total found',       value: completion.jobsDiscovered,    color: 'text-slate-100'   },
              { label: 'duplicates skipped', value: completion.duplicatesSkipped, color: 'text-slate-100'   },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex-1 bg-[#0d1f3c] rounded-md p-2 text-center">
                <div className={`text-[14px] font-bold ${color}`}>{value}</div>
                <div className="text-[8px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            className="w-full text-[10px]"
            onClick={() => router.push(`/candidates/${candidateId}/pipeline`)}
          >
            Review {completion.newJobs} New Jobs in Pipeline →
          </Button>
          <p className="text-[9px] text-slate-500 text-center mt-2">Auto-dismisses in 8s</p>
        </CardContent>
      </Card>
    )
  }

  // ── Render: Error ────────────────────────────────────────────────────────
  if (mode === 'error') {
    return (
      <Card className="bg-[#0a1628] border-red-700 mb-5">
        <CardContent className="p-4">
          <p className="text-[12px] font-semibold text-red-400 mb-1">Search failed</p>
          <p className="text-[11px] text-slate-400 mb-3">{errorMsg}</p>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setMode('idle')}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Render: Idle ─────────────────────────────────────────────────────────
  return (
    <Card className="bg-[#0a1628] border-[#1e3a5f] mb-5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[9px] font-bold tracking-widest text-blue-300 uppercase">Job Search</p>
            <p className="text-[13px] font-semibold text-slate-100 mt-0.5">
              {formatLastSearched(lastSearch?.lastSearchAt ?? null)}
            </p>
          </div>
          {staleBadge && (
            <Badge className="bg-amber-950/60 text-amber-400 border-amber-700 text-[9px]">
              {staleBadge}
            </Badge>
          )}
        </div>

        <div className="flex gap-2 mb-3">
          <div className="flex-1 bg-[#0d1f3c] rounded-md p-2">
            <p className="text-[8px] text-slate-500 mb-0.5">Last run found</p>
            {lastSearch?.jobsDiscovered != null ? (
              <p className="text-[15px] font-bold text-slate-100">
                {lastSearch.jobsDiscovered}{' '}
                <span className="text-[9px] font-semibold text-emerald-400">
                  +{lastSearch.newJobs} new
                </span>
              </p>
            ) : (
              <p className="text-[13px] text-slate-500">—</p>
            )}
          </div>
          <div className="flex-1 bg-[#0d1f3c] rounded-md p-2">
            <p className="text-[8px] text-slate-500 mb-0.5">Awaiting review</p>
            <p className="text-[15px] font-bold text-slate-100">{awaitingReview}</p>
          </div>
          <div className="flex-1 bg-[#0d1f3c] rounded-md p-2">
            <p className="text-[8px] text-slate-500 mb-0.5">Score failures</p>
            <p className={`text-[15px] font-bold ${scoreFailed > 0 ? 'text-red-400' : 'text-slate-100'}`}>
              {scoreFailed}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-[2] flex flex-col gap-1">
            <Button
              size="sm"
              className="w-full text-xs"
              onClick={handleSearch}
              isLoading={searchLoading}
            >
              🔍 Search for New Jobs
            </Button>
            {cooldownNote && (
              <p className="text-[9px] text-slate-500 text-center">{cooldownNote}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs border-[#1e2d4a] text-slate-400 hover:text-slate-300"
            onClick={handleRescore}
            isLoading={rescoreLoading}
          >
            ↻ Re-score All
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/components/dashboard/JobSearchCard.test.tsx
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/JobSearchCard.tsx src/__tests__/components/dashboard/JobSearchCard.test.tsx
git commit -m "feat: add JobSearchCard component with idle, running, complete, error states"
```

---

## Task 5: Wire JobSearchCard into DashboardPage

**Files:**
- Modify: `src/app/candidates/[id]/dashboard/page.tsx`

- [ ] **Step 1: Remove PHASE_OPTIONS and related state**

In `src/app/candidates/[id]/dashboard/page.tsx`:

Remove the entire `PHASE_OPTIONS` constant (lines ~20-24):
```ts
// DELETE this block:
const PHASE_OPTIONS: Array<{ value: PipelineJobType; label: string; description: string }> = [
  { value: 'discovery_only', label: '▶ Full Pipeline',   description: 'Discover → Fetch JDs → Score' },
  { value: 'fetch_jds',      label: '📄 Fetch JDs',      description: 'Fetch JD text for discovered jobs' },
  { value: 'score_jobs',     label: '🏅 Score Jobs',     description: 'Score & grade all fetched JDs' },
]
```

Remove these state declarations:
```ts
// DELETE:
const [selectedPhase, setSelectedPhase] = useState<PipelineJobType>('discovery_only')
const [showPhaseMenu, setShowPhaseMenu] = useState(false)
const phaseMenuRef = useRef<HTMLDivElement>(null)
```

Remove the import of `useRef` only if no other `useRef` calls remain (there are none after removing `phaseMenuRef`). Keep `useRef` import since it's used for... actually check: after removing `phaseMenuRef`, `useRef` is no longer used in this file. Remove it from the `import` line.

Also remove `pipelineLoading`, `chainJobIds`, `pipelineStatus`, `startPipeline` since `JobSearchCard` now manages its own polling:
```ts
// DELETE these state vars:
const [chainJobIds, setChainJobIds]     = useState<string[]>([])
const [pipelineStatus, setPipelineStatus] = useState<string | null>(null)
const [pipelineLoading, setPipelineLoading] = useState(false)
```

And delete the entire `startPipeline` function.

- [ ] **Step 2: Add lastSearch state and fetch**

Add `lastSearch` state and update the load function to fetch it in parallel:

```ts
// Add to state declarations:
const [lastSearch, setLastSearch] = useState<import('@/lib/api').LastSearch | null>(null)
const [awaitingReview, setAwaitingReview] = useState(0)
```

Add `getLastSearch` to imports at the top:
```ts
import { getCV, getReadiness, triggerPipeline, getPipelineStatus, getJobStats, resetFailedJobs, getReadyToScoreGroups, getLastSearch } from '@/lib/api'
```

In the `load()` function's `Promise.all`, add the `getLastSearch` call:
```ts
const [cv, r, stats, ready, lastSearchData] = await Promise.all([
  getCV(candidateId),
  getReadiness(candidateId),
  getJobStats(candidateId),
  getReadyToScoreGroups(candidateId).catch(() => ({ totalJobs: 0, groups: [] })),
  getLastSearch(candidateId),
])
setCandidate(cv)
setReadiness(r)
setScoreFailed(stats.scoreFailed)
setJobsMatched(stats.jobsMatched)
setApplications(stats.applications)
setAwaitingReview(stats.awaitingReview)
setReadyToScore(ready.totalJobs)
setLastSearch(lastSearchData)
setLoading(false)
```

Also add a `refreshStats` callback that re-fetches both stats and last-search (called by `onSearchComplete`):
```ts
const refreshStats = useCallback(async () => {
  try {
    const [stats, lastSearchData] = await Promise.all([
      getJobStats(candidateId),
      getLastSearch(candidateId),
    ])
    setScoreFailed(stats.scoreFailed)
    setJobsMatched(stats.jobsMatched)
    setApplications(stats.applications)
    setAwaitingReview(stats.awaitingReview)
    setLastSearch(lastSearchData)
  } catch {
    // silently ignore refresh errors
  }
}, [candidateId])
```

- [ ] **Step 3: Remove the split button from the Topbar actions**

Delete the entire `<div className="relative flex items-center gap-0" ref={phaseMenuRef}>` block (the split button with `▶ Full Pipeline ▾` and the phase dropdown menu).

The Topbar `actions` should now only contain:
- `<CandidateSwitcher>`
- `⚡ Score Batch` button (when readyToScore > 0)
- `⚠ Rescore Failed` button (when scoreFailed > 0)
- `<ImportJobsSheet>`

- [ ] **Step 4: Add JobSearchCard and update PipelineLogPane**

Add the import:
```ts
import { JobSearchCard } from '@/components/dashboard/JobSearchCard'
```

In the main layout, insert `JobSearchCard` between the 4 stat cards and the ReadinessRing grid:
```tsx
{/* Job Search Card — between stat cards and readiness grid */}
<JobSearchCard
  candidateId={candidateId}
  lastSearch={lastSearch}
  awaitingReview={awaitingReview}
  scoreFailed={scoreFailed}
  onSearchComplete={refreshStats}
/>
```

Update `PipelineLogPane` — since `chainJobIds` is removed, pass an empty array (the log pane is now only used for ImportJobsSheet jobs):
```tsx
<PipelineLogPane
  chainJobIds={importJobId ? [importJobId] : []}
  onReviewRequired={() => setBatchSheetOpen(true)}
/>
```

Also remove the `triggerPipeline`, `getPipelineStatus` imports from api.ts imports since they're no longer used directly in the dashboard page — unless `handleRescore` still uses them. Looking at `handleRescore` in the original code: it calls `resetFailedJobs` then `startPipeline`. Since we're removing `startPipeline`, update `handleRescore` to only reset (the `⚠ Rescore Failed` button triggers `resetFailedJobs` only — the actual re-score is now via `JobSearchCard`'s Re-score All):

```ts
async function handleRescore() {
  setRescoreLoading(true)
  try {
    await resetFailedJobs(candidateId)
    setScoreFailed(0)
    setError(null)
  } catch {
    setError('Failed to reset failed jobs. Please try again.')
  } finally {
    setRescoreLoading(false)
  }
}
```

Remove unused imports: `triggerPipeline`, `getPipelineStatus`, `PipelineJobType`.

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output. If you see errors about removed state variables still being referenced in JSX, check that you fully removed the split button block and updated all references.

- [ ] **Step 6: Run tests**

```bash
npm run test:run
```

Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/app/candidates/[id]/dashboard/page.tsx
git commit -m "feat: wire JobSearchCard into dashboard, remove split button"
```

---

## Task 6: Add "New" badge to JobReviewCard

**Files:**
- Modify: `src/components/pipeline/JobReviewCard.tsx`

The `HitlJob.createdAt` field was added in Task 3. Now render a "New" badge for jobs created within the past 24 hours.

- [ ] **Step 1: Write a failing test**

In `src/__tests__/components/pipeline/JobCard.test.tsx` (existing file), add:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { JobReviewCard } from '@/components/pipeline/JobReviewCard'
import type { HitlJob } from '@/lib/api'

// ... (existing mocks from the file)

const BASE_JOB: HitlJob = {
  id: 'job-1',
  title: 'Senior Engineer',
  company: 'Acme',
  location: null,
  source: 'linkedin',
  sourceUrl: 'https://example.com',
  postedAt: null,
  createdAt: new Date().toISOString(),   // just now → "New"
  status: 'scored',
  grade: 'A',
  numericScore: 8.5,
  score10d: null,
  reportMd: null,
  archetype: null,
  archetypeConfidence: null,
  hitlCheckpoint: null,
  outreachTarget: null,
  emailCadence: null,
  errorMessage: null,
}

describe('JobReviewCard — New badge', () => {
  it('shows "New" badge for jobs created within 24 hours', () => {
    render(
      <JobReviewCard
        job={BASE_JOB}
        candidateId="c1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onSnooze={vi.fn()}
      />
    )
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('does not show "New" badge for jobs older than 24 hours', () => {
    const oldJob: HitlJob = {
      ...BASE_JOB,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    }
    render(
      <JobReviewCard
        job={oldJob}
        candidateId="c1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onSnooze={vi.fn()}
      />
    )
    expect(screen.queryByText('New')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/__tests__/components/pipeline/JobCard.test.tsx
```

Expected: FAIL — "New" text not found.

- [ ] **Step 3: Add the "New" badge to JobReviewCard**

In `src/components/pipeline/JobReviewCard.tsx`, find the card header area where the job title and company are rendered. Add a "New" badge when the job was created within 24 hours.

In the component body (after the existing `getDayAge` helper), add:

```tsx
// Inside the component function, after existing constants:
const isNew = (() => {
  try {
    const ms = Date.now() - new Date(job.createdAt).getTime()
    return ms < 24 * 60 * 60 * 1000
  } catch { return false }
})()
```

Then in the JSX where the job title is rendered, add the badge next to it:

```tsx
{/* Add beside job title: */}
{isNew && (
  <Badge className="bg-blue-950/60 text-blue-300 border-blue-700 text-[9px] ml-1">
    New
  </Badge>
)}
```

The exact insertion point is where `job.title` is displayed — typically in a heading `<h3>` or similar. Look for the title rendering and place the badge inline after it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/components/pipeline/JobCard.test.tsx
```

Expected: All tests PASS (including the two new "New badge" tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/JobReviewCard.tsx src/__tests__/components/pipeline/JobCard.test.tsx
git commit -m "feat: add New badge to JobReviewCard for recently discovered jobs"
```

---

## Task 7: Vocabulary fixes — pipeline page + log pane

**Files:**
- Modify: `src/app/candidates/[id]/pipeline/page.tsx`
- Modify: `src/components/dashboard/PipelineLogPane.tsx`
- Modify: `src/__tests__/components/dashboard/PipelineLogPane.test.tsx`

- [ ] **Step 1: Update the empty state button text on the pipeline page**

In `src/app/candidates/[id]/pipeline/page.tsx` at line ~351, change:
```tsx
// BEFORE:
  Run Pipeline →

// AFTER:
  Search for New Jobs →
```

The full button block:
```tsx
<Button
  size="sm"
  variant="outline"
  className="text-[11px] border-[#1e2d4a] text-[#64748b] hover:text-[#94a3b8]"
  onClick={() => router.push(`/candidates/${candidateId}/dashboard`)}
>
  Search for New Jobs →
</Button>
```

- [ ] **Step 2: Update the PipelineLogPane placeholder text**

In `src/components/dashboard/PipelineLogPane.tsx` at line ~260, change:
```tsx
// BEFORE:
'Click ▶ Run Pipeline to begin job discovery'

// AFTER:
'Search for new jobs from the Dashboard to begin'
```

- [ ] **Step 3: Fix the existing PipelineLogPane test**

In `src/__tests__/components/dashboard/PipelineLogPane.test.tsx`, update the test that checks for the placeholder text:

```tsx
// BEFORE (existing test at ~line 22):
expect(screen.getByText(/Run Pipeline/i)).toBeInTheDocument()

// AFTER:
expect(screen.getByText(/Search for new jobs from the Dashboard/i)).toBeInTheDocument()
```

- [ ] **Step 4: Run all tests**

```bash
npm run test:run
```

Expected: 0 failures.

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/candidates/[id]/pipeline/page.tsx src/components/dashboard/PipelineLogPane.tsx src/__tests__/components/dashboard/PipelineLogPane.test.tsx
git commit -m "fix: update pipeline empty state and log pane text to match new Job Search card"
```

---

## Task 8: Pre-merge verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
npm run test:run
```

Expected: 0 failures. Note the total test count for the record.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output (zero type errors).

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: Exits with code 0. No prerender errors. Check the output for any `ERROR` lines.

- [ ] **Step 4: Manual smoke test**

1. Start `npm run dev`
2. Navigate to `http://localhost:3000/candidates/<id>/dashboard`
3. Confirm the split button (`▶ Full Pipeline ▾`) is gone from the topbar
4. Confirm the `JobSearchCard` appears between the 4 stat cards and the ReadinessRing grid
5. Check idle state renders: last-search timestamp, stats row (last run found / awaiting review / score failures), both action buttons
6. If a discovery run has completed, verify last-search stats show real numbers
7. Click "Search for New Jobs" and confirm the P1 step tracker replaces the stats row
8. Navigate to `/candidates/<id>/pipeline`
9. Confirm the empty state button reads "Search for New Jobs →"
10. In the Dashboard's PipelineLogPane, confirm placeholder reads "Search for new jobs from the Dashboard to begin"
11. Check that recently discovered jobs show a "New" badge in the pipeline review

- [ ] **Step 5: Commit verification result**

No code changes needed here — this step is complete when all three commands pass and the manual smoke test passes.

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|---|---|
| GET /api/candidates/[id]/last-search endpoint | Task 2 |
| getLastSearch() client function | Task 3 |
| JobSearchCard — idle fresh/normal/stale states | Task 4 |
| JobSearchCard — running state with P1 step tracker | Task 4 (component) |
| JobSearchCard — complete C1 summary + 8s auto-dismiss | Task 4 (component) |
| JobSearchCard — error state with retry | Task 4 (component) |
| Soft 6h cooldown note (CD1) | Task 4 |
| Stale badge (> 7 days) | Task 4 |
| Remove split button from topbar | Task 5 |
| Wire JobSearchCard into DashboardPage | Task 5 |
| awaitingReview stat from job stats endpoint | Task 1 |
| "New" badge on recently discovered pipeline jobs | Task 6 |
| Pipeline empty state button text change | Task 7 |
| PipelineLogPane placeholder text change | Task 7 |

All spec requirements covered.

### No new agent code

The spec explicitly says "no new agent code required" — confirmed, no Python files are touched.

### Polling follows followUpJobId chain

The `poll()` function in `JobSearchCard` recursively follows `status.followUpJobId` (same pattern as the existing `startPipeline` in DashboardPage), advancing step index based on the job's `jobType` value mapped via `JOB_TYPE_TO_STEP`.

### Re-score All only shows Score step active

When triggered via `handleRescore()`, `startStepsForJobType('score_jobs')` sets steps 0-1 as `'pending'` (dimmed) and step 2 as `'active'`. Steps 0-1 never transition to `'done'` in `rescoreOnly` mode.
