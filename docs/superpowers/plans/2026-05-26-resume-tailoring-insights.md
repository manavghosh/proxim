# Resume Tailoring Visibility & Outreach Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface existing resume tailoring data (keywords, archetype, confidence) in the job card UI, and add an outreach insights funnel card to the dashboard showing open/reply rates and archetype breakdowns.

**Architecture:** All backend data already exists — `resume_versions` table tracks tailoring metadata, `emailDrafts` tracks open/click timestamps, `emailCadences` tracks replies. This is purely a UI + aggregation API layer: one new API endpoint (`GET /api/candidates/[id]/insights`), two new components (`TailoredResumeCard`, `InsightsFunnelCard`), and targeted updates to `JobCard`, `EmailDraftCard`, and `ManualSendDraftCard`.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (SQLite + Neon dual-runtime via `src/db/index.ts`), shadcn/ui, Tailwind CSS v4, lucide-react, Vitest + Testing Library.

---

### Task 1: Types + API Client

**Files:**
- Modify: `src/types/candidate.ts` (append `ResumeVersionSummary` and `InsightsResponse`)
- Modify: `src/lib/api.ts` (append `getInsights()`)

- [ ] **Step 1: Write failing type test**

Create `src/__tests__/types/insights-types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest'
import type { InsightsResponse } from '@/types/candidate'

describe('InsightsResponse type', () => {
  it('funnel counts are numbers', () => {
    expectTypeOf<InsightsResponse['funnel']['discovered']>().toEqualTypeOf<number>()
    expectTypeOf<InsightsResponse['funnel']['day1Sent']>().toEqualTypeOf<number>()
  })

  it('rates are nullable numbers', () => {
    expectTypeOf<InsightsResponse['rates']['openRate']>().toEqualTypeOf<number | null>()
    expectTypeOf<InsightsResponse['rates']['replyRate']>().toEqualTypeOf<number | null>()
  })

  it('archetypeBreakdown rows have correct shape', () => {
    type Row = InsightsResponse['archetypeBreakdown'][number]
    expectTypeOf<Row['archetype']>().toEqualTypeOf<string>()
    expectTypeOf<Row['replyRate']>().toEqualTypeOf<number | null>()
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/__tests__/types/insights-types.test.ts
```
Expected: FAIL — `InsightsResponse` not found

- [ ] **Step 3: Add types to `src/types/candidate.ts`**

Append after the existing `PipelineRunSummary` interface (after line 173):

```typescript
// ── Resume Tailoring Visibility (F9) ─────────────────────────────────────────

export interface ResumeVersionSummary {
  id: string
  jobId: string
  candidateId: string | null
  keywords: string[] | null
  archetype: string | null
  archetypeConfidence: number | null
  versionN: number
  resumePdfPath: string | null
  coverLetterPdfPath: string | null
  baseCvHash: string | null
  generationStatus: string
  isStale: boolean
  createdAt: string
}

// ── Outreach Insights (F9) ────────────────────────────────────────────────────

export interface InsightsFunnel {
  discovered: number
  approved: number
  day1Sent: number
  opened: number
  replied: number
  callbacks: number
}

export interface InsightsRates {
  openRate: number | null
  replyRate: number | null
  abGradeRate: number | null
  callbackRate: number | null
}

export interface ArchetypeBreakdownRow {
  archetype: string
  approved: number
  sent: number
  replied: number
  replyRate: number | null
}

export interface InsightsResponse {
  funnel: InsightsFunnel
  rates: InsightsRates
  archetypeBreakdown: ArchetypeBreakdownRow[]
}
```

- [ ] **Step 4: Run type test — confirm it passes**

```bash
npx vitest run src/__tests__/types/insights-types.test.ts
```
Expected: PASS

- [ ] **Step 5: Add `getInsights()` to `src/lib/api.ts`**

Append after the `exportRunHistory` function (before `markInterview`):

```typescript
// ── Outreach Insights (F9) ────────────────────────────────────────────────────

import type { InsightsResponse } from '@/types/candidate'

export async function getInsights(candidateId: string): Promise<InsightsResponse | null> {
  try {
    return await request(`/api/candidates/${encodeURIComponent(candidateId)}/insights`)
  } catch {
    return null
  }
}
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output (zero errors)

- [ ] **Step 7: Commit**

```bash
git add src/types/candidate.ts src/lib/api.ts src/__tests__/types/insights-types.test.ts
git commit -m "feat(009): add ResumeVersionSummary, InsightsResponse types and getInsights API client"
```

---

### Task 2: Insights API Route

**Files:**
- Create: `src/app/api/candidates/[id]/insights/route.ts`
- Create: `src/__tests__/api/candidates/insights.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/api/candidates/insights.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

// We test the aggregation logic via the exported helper, not the route handler itself
// The route is thin — just calls aggregateInsights and returns JSON.
// We test aggregateInsights directly.

import { aggregateInsights } from '@/app/api/candidates/[id]/insights/route'

describe('aggregateInsights', () => {
  it('returns all-zero funnel with null rates when no data', async () => {
    const result = await aggregateInsights('cand-1', {
      jobs: [],
      cadences: [],
      drafts: [],
    })
    expect(result.funnel.discovered).toBe(0)
    expect(result.funnel.day1Sent).toBe(0)
    expect(result.rates.openRate).toBeNull()
    expect(result.rates.replyRate).toBeNull()
    expect(result.archetypeBreakdown).toEqual([])
  })

  it('computes open rate correctly', async () => {
    const result = await aggregateInsights('cand-1', {
      jobs: [
        { id: 'j1', status: 'approved', archetype: null, archetypeConfidence: null, interviewCallbackAt: null, scoreGrade: 'A' },
      ],
      cadences: [
        { id: 'c1', jobId: 'j1', replyDetectedAt: null, status: 'active' },
      ],
      drafts: [
        { id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: '2026-01-02T10:00:00Z' },
      ],
    })
    expect(result.funnel.day1Sent).toBe(1)
    expect(result.funnel.opened).toBe(1)
    expect(result.rates.openRate).toBeCloseTo(1.0)
  })

  it('excludes orphaned opens (openDetectedAt set but sentAt null)', async () => {
    const result = await aggregateInsights('cand-1', {
      jobs: [{ id: 'j1', status: 'approved', archetype: null, archetypeConfidence: null, interviewCallbackAt: null, scoreGrade: 'A' }],
      cadences: [{ id: 'c1', jobId: 'j1', replyDetectedAt: null, status: 'active' }],
      drafts: [
        { id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: null, openDetectedAt: '2026-01-02T10:00:00Z' },
      ],
    })
    expect(result.funnel.opened).toBe(0)
    expect(result.rates.openRate).toBeNull()
  })

  it('counts replied cadences including cancelled ones', async () => {
    const result = await aggregateInsights('cand-1', {
      jobs: [{ id: 'j1', status: 'approved', archetype: null, archetypeConfidence: null, interviewCallbackAt: null, scoreGrade: 'A' }],
      cadences: [{ id: 'c1', jobId: 'j1', replyDetectedAt: '2026-01-03T10:00:00Z', status: 'cancelled' }],
      drafts: [{ id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: null }],
    })
    expect(result.funnel.replied).toBe(1)
  })

  it('deduplicates multiple Day 1 drafts per cadence (retries)', async () => {
    const result = await aggregateInsights('cand-1', {
      jobs: [{ id: 'j1', status: 'approved', archetype: null, archetypeConfidence: null, interviewCallbackAt: null, scoreGrade: 'A' }],
      cadences: [{ id: 'c1', jobId: 'j1', replyDetectedAt: null, status: 'active' }],
      drafts: [
        { id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T08:00:00Z', openDetectedAt: null },
        { id: 'd2', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: null },
      ],
    })
    expect(result.funnel.day1Sent).toBe(1)
  })

  it('ranks archetype breakdown by replyRate descending', async () => {
    const result = await aggregateInsights('cand-1', {
      jobs: [
        { id: 'j1', status: 'approved', archetype: 'Enterprise CAIO', archetypeConfidence: 0.9, interviewCallbackAt: null, scoreGrade: 'A' },
        { id: 'j2', status: 'approved', archetype: 'Startup CTO', archetypeConfidence: 0.8, interviewCallbackAt: null, scoreGrade: 'B' },
      ],
      cadences: [
        { id: 'c1', jobId: 'j1', replyDetectedAt: '2026-01-03T10:00:00Z', status: 'replied' },
        { id: 'c2', jobId: 'j2', replyDetectedAt: null, status: 'active' },
      ],
      drafts: [
        { id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: null },
        { id: 'd2', cadenceId: 'c2', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: null },
      ],
    })
    expect(result.archetypeBreakdown[0].archetype).toBe('Enterprise CAIO')
    expect(result.archetypeBreakdown[0].replyRate).toBeCloseTo(1.0)
    expect(result.archetypeBreakdown[1].archetype).toBe('Startup CTO')
    expect(result.archetypeBreakdown[1].replyRate).toBe(0)
  })

  it('hides archetype breakdown when fewer than 2 archetypes', async () => {
    const result = await aggregateInsights('cand-1', {
      jobs: [{ id: 'j1', status: 'approved', archetype: 'Enterprise CAIO', archetypeConfidence: 0.9, interviewCallbackAt: null, scoreGrade: 'A' }],
      cadences: [],
      drafts: [],
    })
    expect(result.archetypeBreakdown).toEqual([])
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run src/__tests__/api/candidates/insights.test.ts
```
Expected: FAIL — `aggregateInsights` not found

- [ ] **Step 3: Create the API route with exported `aggregateInsights`**

Create `src/app/api/candidates/[id]/insights/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { jobs, emailCadences, emailDrafts } from '@/db/schema'
import { eq, and, isNotNull, inArray } from 'drizzle-orm'
import type { InsightsResponse, InsightsFunnel, InsightsRates, ArchetypeBreakdownRow } from '@/types/candidate'

// ─── Pure aggregation logic (exported for unit testing) ──────────────────────

interface RawJob {
  id: string
  status: string
  archetype: string | null
  archetypeConfidence: number | null
  interviewCallbackAt: Date | string | null
  scoreGrade: string | null
}

interface RawCadence {
  id: string
  jobId: string
  replyDetectedAt: Date | string | null
  status: string
}

interface RawDraft {
  id: string
  cadenceId: string
  dayNumber: number
  sentAt: Date | string | null
  openDetectedAt: Date | string | null
}

interface RawData {
  jobs: RawJob[]
  cadences: RawCadence[]
  drafts: RawDraft[]
}

export function aggregateInsights(candidateId: string, data: RawData): InsightsResponse {
  const { jobs: allJobs, cadences: allCadences, drafts: allDrafts } = data

  // Funnel counts
  const APPROVED_STATUSES = new Set([
    'approved', 'resume_ready', 'resume_failed', 'submitted', 'score_failed',
  ])
  const approvedJobs = allJobs.filter(j => APPROVED_STATUSES.has(j.status))
  const discovered = allJobs.length
  const approved = approvedJobs.length

  // Day 1 sent: deduplicate retries — keep only most recent sentAt per cadence
  const day1DraftsByCadence = new Map<string, RawDraft>()
  for (const d of allDrafts) {
    if (d.dayNumber !== 1 || !d.sentAt) continue
    const existing = day1DraftsByCadence.get(d.cadenceId)
    if (!existing || new Date(d.sentAt) > new Date(existing.sentAt!)) {
      day1DraftsByCadence.set(d.cadenceId, d)
    }
  }
  const day1Sent = day1DraftsByCadence.size

  // Opened: distinct cadences where at least one draft has both sentAt AND openDetectedAt
  const openedCadenceIds = new Set<string>()
  for (const d of allDrafts) {
    if (d.sentAt && d.openDetectedAt) openedCadenceIds.add(d.cadenceId)
  }
  const opened = openedCadenceIds.size

  // Replied: cadences with replyDetectedAt (regardless of cancellation status)
  const replied = allCadences.filter(c => c.replyDetectedAt).length

  // Callbacks
  const callbacks = allJobs.filter(j => j.interviewCallbackAt).length

  const funnel: InsightsFunnel = { discovered, approved, day1Sent, opened, replied, callbacks }

  // Rates (null when denominator is zero)
  const abCount = approvedJobs.filter(j => j.scoreGrade === 'A' || j.scoreGrade === 'B').length
  const rates: InsightsRates = {
    openRate:     day1Sent > 0 ? opened / day1Sent : null,
    replyRate:    day1Sent > 0 ? replied / day1Sent : null,
    abGradeRate:  approved > 0 ? abCount / approved : null,
    callbackRate: approved > 0 ? callbacks / approved : null,
  }

  // Archetype breakdown
  const archetypeJobs = approvedJobs.filter(j => j.archetype)
  const uniqueArchetypes = new Set(archetypeJobs.map(j => j.archetype!))

  if (uniqueArchetypes.size < 2) {
    return { funnel, rates, archetypeBreakdown: [] }
  }

  const cadenceByJobId = new Map<string, RawCadence[]>()
  for (const c of allCadences) {
    const arr = cadenceByJobId.get(c.jobId) ?? []
    arr.push(c)
    cadenceByJobId.set(c.jobId, arr)
  }

  const sentCadenceIds = new Set(day1DraftsByCadence.keys())

  const breakdown: ArchetypeBreakdownRow[] = []
  for (const archetype of uniqueArchetypes) {
    const archetypeJobIds = archetypeJobs.filter(j => j.archetype === archetype).map(j => j.id)
    const archetypeCadences = archetypeJobIds.flatMap(id => cadenceByJobId.get(id) ?? [])
    const sent = archetypeCadences.filter(c => sentCadenceIds.has(c.id)).length
    const archetypeReplied = archetypeCadences.filter(c => c.replyDetectedAt).length
    breakdown.push({
      archetype,
      approved: archetypeJobIds.length,
      sent,
      replied: archetypeReplied,
      replyRate: sent > 0 ? archetypeReplied / sent : 0,
    })
  }

  breakdown.sort((a, b) => (b.replyRate ?? 0) - (a.replyRate ?? 0))

  return { funnel, rates, archetypeBreakdown: breakdown.slice(0, 5) }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: candidateId } = await params

  const [allJobs, allCadences, allDrafts] = await Promise.all([
    db
      .select({
        id: jobs.id,
        status: jobs.status,
        archetype: jobs.archetype,
        archetypeConfidence: jobs.archetypeConfidence,
        interviewCallbackAt: jobs.interviewCallbackAt,
        scoreGrade: jobs.scoreGrade,
      })
      .from(jobs)
      .where(eq(jobs.candidateId, candidateId)),

    db
      .select({
        id: emailCadences.id,
        jobId: emailCadences.jobId,
        replyDetectedAt: emailCadences.replyDetectedAt,
        status: emailCadences.status,
      })
      .from(emailCadences)
      .where(eq(emailCadences.candidateId, candidateId)),

    db
      .select({
        id: emailDrafts.id,
        cadenceId: emailDrafts.cadenceId,
        dayNumber: emailDrafts.dayNumber,
        sentAt: emailDrafts.sentAt,
        openDetectedAt: emailDrafts.openDetectedAt,
      })
      .from(emailDrafts)
      .where(
        inArray(
          emailDrafts.cadenceId,
          db
            .select({ id: emailCadences.id })
            .from(emailCadences)
            .where(eq(emailCadences.candidateId, candidateId))
        )
      ),
  ])

  const result = aggregateInsights(candidateId, {
    jobs: allJobs.map(j => ({
      ...j,
      archetypeConfidence: j.archetypeConfidence ? Number(j.archetypeConfidence) : null,
    })),
    cadences: allCadences,
    drafts: allDrafts,
  })

  return NextResponse.json(result)
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run src/__tests__/api/candidates/insights.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/app/api/candidates/[id]/insights/route.ts src/__tests__/api/candidates/insights.test.ts
git commit -m "feat(009): add GET /api/candidates/[id]/insights route with aggregateInsights"
```

---

### Task 3: InsightsFunnelCard Component + Dashboard Wire-up

**Files:**
- Create: `src/components/dashboard/InsightsFunnelCard.tsx`
- Modify: `src/app/candidates/[id]/dashboard/page.tsx`
- Create: `src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { InsightsFunnelCard } from '@/components/dashboard/InsightsFunnelCard'
import type { InsightsResponse } from '@/types/candidate'

const fullInsights: InsightsResponse = {
  funnel: { discovered: 50, approved: 20, day1Sent: 10, opened: 6, replied: 3, callbacks: 1 },
  rates: { openRate: 0.6, replyRate: 0.3, abGradeRate: 0.65, callbackRate: 0.05 },
  archetypeBreakdown: [
    { archetype: 'Enterprise CAIO', approved: 10, sent: 6, replied: 3, replyRate: 0.5 },
    { archetype: 'Startup CTO', approved: 10, sent: 4, replied: 0, replyRate: 0 },
  ],
}

const emptyInsights: InsightsResponse = {
  funnel: { discovered: 0, approved: 0, day1Sent: 0, opened: 0, replied: 0, callbacks: 0 },
  rates: { openRate: null, replyRate: null, abGradeRate: null, callbackRate: null },
  archetypeBreakdown: [],
}

describe('InsightsFunnelCard', () => {
  it('renders funnel stage counts', () => {
    render(<InsightsFunnelCard insights={fullInsights} />)
    expect(screen.getByText('50')).toBeInTheDocument() // discovered
    expect(screen.getByText('20')).toBeInTheDocument() // approved
    expect(screen.getByText('10')).toBeInTheDocument() // day1Sent
  })

  it('shows rate as percentage', () => {
    render(<InsightsFunnelCard insights={fullInsights} />)
    expect(screen.getByText('60%')).toBeInTheDocument() // openRate
    expect(screen.getByText('30%')).toBeInTheDocument() // replyRate
  })

  it('shows — for null rates', () => {
    render(<InsightsFunnelCard insights={emptyInsights} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(4)
  })

  it('shows empty state when no outreach sent', () => {
    render(<InsightsFunnelCard insights={emptyInsights} />)
    expect(screen.getByText(/send your first email/i)).toBeInTheDocument()
  })

  it('renders archetype breakdown when ≥2 archetypes', () => {
    render(<InsightsFunnelCard insights={fullInsights} />)
    expect(screen.getByText('Enterprise CAIO')).toBeInTheDocument()
    expect(screen.getByText('Startup CTO')).toBeInTheDocument()
  })

  it('hides archetype breakdown when empty', () => {
    render(<InsightsFunnelCard insights={emptyInsights} />)
    expect(screen.queryByText('Archetype')).not.toBeInTheDocument()
  })

  it('handles null insights gracefully (loading state)', () => {
    render(<InsightsFunnelCard insights={null} />)
    // Should render loading skeleton, not crash
    expect(document.body).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx
```
Expected: FAIL — component not found

- [ ] **Step 3: Create `InsightsFunnelCard` component**

Create `src/components/dashboard/InsightsFunnelCard.tsx`:

```typescript
'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import type { InsightsResponse, ArchetypeBreakdownRow } from '@/types/candidate'

interface Props {
  insights: InsightsResponse | null
}

function fmt(rate: number | null): string {
  if (rate === null) return '—'
  return `${Math.round(rate * 100)}%`
}

function FunnelStage({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[18px] font-bold text-slate-100">{count}</span>
      <span className="text-[9px] text-slate-500 uppercase tracking-wide text-center">{label}</span>
    </div>
  )
}

function RateCard({ label, value }: { label: string; value: string }) {
  const isEmpty = value === '—'
  return (
    <div className="bg-[#0d1f3c] rounded-lg p-2 flex flex-col gap-0.5">
      <p className="text-[8px] text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-[15px] font-bold ${isEmpty ? 'text-slate-600' : 'text-slate-100'}`}>
        {value}
      </p>
    </div>
  )
}

function ArchetypeTable({ rows }: { rows: ArchetypeBreakdownRow[] }) {
  if (rows.length < 2) return null
  return (
    <div className="mt-3">
      <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-1.5">Archetype Reply Rates</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.archetype} className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-300 truncate flex-1">{row.archetype}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-slate-500">{row.sent} sent</span>
              <Badge
                className={`text-[10px] px-1.5 py-0 ${
                  (row.replyRate ?? 0) > 0
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
                    : 'bg-[#0d1829] text-slate-500 border-[#1e2d4a]'
                }`}
              >
                {fmt(row.replyRate)}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function InsightsFunnelCard({ insights }: Props) {
  if (insights === null) {
    return (
      <Card className="bg-[#0a1628] border-[#1e3a5f] py-4 gap-3">
        <CardContent>
          <Skeleton className="h-4 w-32 mb-3" />
          <div className="grid grid-cols-6 gap-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        </CardContent>
      </Card>
    )
  }

  const { funnel, rates, archetypeBreakdown } = insights
  const hasOutreach = funnel.day1Sent > 0

  return (
    <Card className="bg-[#0a1628] border-[#1e3a5f] py-4 gap-3">
      <CardContent className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold tracking-widest text-blue-300 uppercase">
            Outreach Insights
          </span>
        </div>

        {/* Funnel row */}
        <div className="grid grid-cols-6 gap-1 bg-[#0d1f3c] rounded-lg p-3">
          <FunnelStage label="Found" count={funnel.discovered} />
          <FunnelStage label="Approved" count={funnel.approved} />
          <FunnelStage label="Sent" count={funnel.day1Sent} />
          <FunnelStage label="Opened" count={funnel.opened} />
          <FunnelStage label="Replied" count={funnel.replied} />
          <FunnelStage label="Callback" count={funnel.callbacks} />
        </div>

        {/* Rate cards */}
        <div className="grid grid-cols-4 gap-2">
          <RateCard label="Open rate" value={fmt(rates.openRate)} />
          <RateCard label="Reply rate" value={fmt(rates.replyRate)} />
          <RateCard label="A/B grade" value={fmt(rates.abGradeRate)} />
          <RateCard label="Callback" value={fmt(rates.callbackRate)} />
        </div>

        {/* Empty state */}
        {!hasOutreach && (
          <p className="text-[10px] text-slate-600 text-center">
            Send your first email to see performance data.
          </p>
        )}

        {/* Archetype breakdown */}
        <ArchetypeTable rows={archetypeBreakdown} />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx
```
Expected: all PASS

- [ ] **Step 5: Wire into dashboard page**

In `src/app/candidates/[id]/dashboard/page.tsx`:

Add import at top (after existing imports):
```typescript
import { getInsights } from '@/lib/api'
import { InsightsFunnelCard } from '@/components/dashboard/InsightsFunnelCard'
import type { InsightsResponse } from '@/types/candidate'
```

Add state variable (after `awaitingReview` state):
```typescript
const [insights, setInsights] = useState<InsightsResponse | null>(null)
```

Find the `Promise.all` block in `loadData()` and add `getInsights` in parallel. The existing call looks like:
```typescript
const [cv, readiness, stats, readyToScoreRes, lastSearchRes] = await Promise.all([
  getCV(candidateId),
  getReadiness(candidateId),
  getJobStats(candidateId),
  getReadyToScoreGroups(candidateId),
  getLastSearch(candidateId),
])
```

Change it to:
```typescript
const [cv, readiness, stats, readyToScoreRes, lastSearchRes, insightsRes] = await Promise.all([
  getCV(candidateId),
  getReadiness(candidateId),
  getJobStats(candidateId),
  getReadyToScoreGroups(candidateId),
  getLastSearch(candidateId),
  getInsights(candidateId),
])
```

And set state after the existing setters:
```typescript
setInsights(insightsRes)
```

In the JSX, add `InsightsFunnelCard` below `JobSearchCard`:
```tsx
<JobSearchCard
  candidateId={candidateId}
  lastSearch={lastSearch}
  awaitingReview={awaitingReview}
  scoreFailed={scoreFailed}
  onSearchComplete={refreshData}
  onOpenBatchSheet={() => setBatchSheetOpen(true)}
/>
<InsightsFunnelCard insights={insights} />
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output

- [ ] **Step 7: Run full test suite**

```bash
npm run test:run
```
Expected: all tests PASS (existing + new)

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/InsightsFunnelCard.tsx src/app/candidates/[id]/dashboard/page.tsx src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx
git commit -m "feat(009): add InsightsFunnelCard and wire into dashboard page"
```

---

### Task 4: TailoredResumeCard Component

**Files:**
- Create: `src/components/applications/TailoredResumeCard.tsx`
- Create: `src/__tests__/components/applications/TailoredResumeCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/components/applications/TailoredResumeCard.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TailoredResumeCard } from '@/components/applications/TailoredResumeCard'
import type { ResumeVersion } from '@/lib/api'

const baseVersion: ResumeVersion = {
  id: 'rv1',
  jobId: 'j1',
  candidateId: 'c1',
  archetype: 'Enterprise CAIO',
  archetypeConfidence: '0.85',
  keywords: ['AI Strategy', 'Digital Transformation', 'Executive Leadership'],
  resumePdfPath: '/pdfs/rv1.pdf',
  coverLetterPdfPath: '/pdfs/rv1-cl.pdf',
  baseCvHash: 'abc123',
  isSubmitted: false,
  generationStatus: 'completed',
  errorMessage: null,
  versionN: 1,
  createdAt: '2026-01-01T10:00:00Z',
  isStale: false,
}

describe('TailoredResumeCard', () => {
  it('renders archetype name and confidence', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.getByText('Enterprise CAIO')).toBeInTheDocument()
    expect(screen.getByText(/85%/)).toBeInTheDocument()
  })

  it('renders keyword pills', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.getByText('AI Strategy')).toBeInTheDocument()
    expect(screen.getByText('Digital Transformation')).toBeInTheDocument()
  })

  it('shows low confidence badge when archetypeConfidence < 0.5', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, archetypeConfidence: '0.4' }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument()
  })

  it('shows stale warning when isStale is true', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, isStale: true }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/cv updated since tailoring/i)).toBeInTheDocument()
  })

  it('shows no keywords message when keywords is empty', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, keywords: [] }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/no keywords detected/i)).toBeInTheDocument()
  })

  it('shows spinner when resumePdfPath is null (generation in progress)', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, resumePdfPath: null }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/generating/i)).toBeInTheDocument()
  })

  it('filters empty strings from keywords array', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, keywords: ['', 'AI Strategy', ''] }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText('AI Strategy')).toBeInTheDocument()
    expect(screen.queryByText('')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run src/__tests__/components/applications/TailoredResumeCard.test.tsx
```
Expected: FAIL — component not found

- [ ] **Step 3: Create `TailoredResumeCard` component**

Create `src/components/applications/TailoredResumeCard.tsx`:

```typescript
'use client'

import { FileTextIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ResumeVersion } from '@/lib/api'

interface Props {
  version: ResumeVersion
  onViewResume: () => void
  onViewCoverLetter: () => void
}

export function TailoredResumeCard({ version, onViewResume, onViewCoverLetter }: Props) {
  const confidence = version.archetypeConfidence ? Number(version.archetypeConfidence) : null
  const isLowConfidence = confidence !== null && confidence < 0.5
  const keywords = (version.keywords ?? []).filter(k => k.trim() !== '')
  const isPdfReady = Boolean(version.resumePdfPath)

  return (
    <div className="rounded-lg border border-[#1e2d4a] bg-[#0a1628] p-3 space-y-3">
      {/* Stale warning */}
      {version.isStale && (
        <div className="rounded-md bg-amber-950/30 border border-amber-800/40 px-2.5 py-1.5">
          <p className="text-[11px] text-amber-400">
            ⚠ CV updated since tailoring — consider re-tailoring.
          </p>
        </div>
      )}

      {/* Archetype row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] text-slate-500 uppercase tracking-wide">Archetype</span>
        {version.archetype ? (
          <>
            <span className="text-[12px] font-semibold text-slate-100">{version.archetype}</span>
            {confidence !== null && (
              isLowConfidence ? (
                <Badge className="bg-amber-950/40 text-amber-400 border-amber-800/40 text-[9px] px-1.5 py-0">
                  Low confidence · {Math.round(confidence * 100)}%
                </Badge>
              ) : (
                <Badge className="bg-[#0d1f3c] text-slate-400 border-[#1e2d4a] text-[9px] px-1.5 py-0">
                  {Math.round(confidence * 100)}%
                </Badge>
              )
            )}
          </>
        ) : (
          <span className="text-[11px] text-slate-600">Not detected</span>
        )}
      </div>

      {/* Keywords */}
      <div className="space-y-1">
        <span className="text-[9px] text-slate-500 uppercase tracking-wide">
          Keywords injected
        </span>
        {keywords.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {keywords.map((kw) => (
              <Badge
                key={kw}
                className="bg-blue-950/40 text-blue-300 border-blue-800/40 text-[10px] px-1.5 py-0"
              >
                {kw}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 italic">No keywords detected</p>
        )}
      </div>

      {/* PDF actions */}
      <div className="flex items-center gap-2">
        {isPdfReady ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 border-[#1e2d4a] text-[#93c5fd]"
              onClick={onViewResume}
            >
              <FileTextIcon className="w-3 h-3" />
              View Resume
            </Button>
            {version.coverLetterPdfPath && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 border-[#1e2d4a] text-[#93c5fd]"
                onClick={onViewCoverLetter}
              >
                <FileTextIcon className="w-3 h-3" />
                View Cover Letter
              </Button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Spinner className="w-3 h-3" />
            Generating PDF…
          </div>
        )}
        <span className="text-[10px] text-slate-600 ml-auto">v{version.versionN}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run src/__tests__/components/applications/TailoredResumeCard.test.tsx
```
Expected: all PASS

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/components/applications/TailoredResumeCard.tsx src/__tests__/components/applications/TailoredResumeCard.test.tsx
git commit -m "feat(009): add TailoredResumeCard component with keywords, archetype, stale warning"
```

---

### Task 5: JobCard Integration

**Files:**
- Modify: `src/components/applications/JobCard.tsx`

- [ ] **Step 1: Locate and understand the current state**

Read `src/components/applications/JobCard.tsx` lines 1-50 (imports/props) and 280-420 (resume section and action buttons). Key things to change:
- Line 345: `'Generate Resume'` → `'✨ Tailor for This Role'`
- Line 338: add `disabled` condition when `jdRaw` is empty
- After the action buttons section: render `TailoredResumeCard` when `resume_versions` exist

- [ ] **Step 2: Add import for `TailoredResumeCard`**

In `src/components/applications/JobCard.tsx`, add to the imports:
```typescript
import { TailoredResumeCard } from '@/components/applications/TailoredResumeCard'
```

- [ ] **Step 3: Rename the button and add disabled state**

Find (at line ~338-346):
```typescript
{isApproved && !localResumeFailed && (
  <Button size="sm" variant="outline"
    className="h-7 text-[11px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
    onClick={() => onGenerateResume(job.id)}
    disabled={isPending || buildRunning}
    isLoading={buildRunning}>
    <FileTextIcon className="w-3 h-3" />
    {buildRunning ? 'AI Agent writing…' : 'Generate Resume'}
  </Button>
)}
```

Replace with:
```typescript
{isApproved && !localResumeFailed && (
  <Button size="sm" variant="outline"
    className="h-7 text-[11px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
    onClick={() => onGenerateResume(job.id)}
    disabled={isPending || buildRunning || !job.jdRaw}
    isLoading={buildRunning}
    title={!job.jdRaw ? 'Fetch JD first before tailoring' : undefined}>
    <FileTextIcon className="w-3 h-3" />
    {buildRunning ? 'AI Agent writing…' : '✨ Tailor for This Role'}
  </Button>
)}
```

- [ ] **Step 4: Render `TailoredResumeCard` below the action buttons**

In the expanded job card section, find where the `BuildProgressPane` renders (around line 436-445). After the action buttons `</div>` closing tag and before `BuildProgressPane`, add:

```typescript
{/* Tailored resume card — shows when resume_versions exists */}
{resumeVersions && resumeVersions.length > 0 && (() => {
  const best = [...resumeVersions].sort((a, b) => b.versionN - a.versionN)[0]
  return (
    <TailoredResumeCard
      version={best}
      onViewResume={() => onViewResume?.(job.id)}
      onViewCoverLetter={() => onViewCoverLetter?.(job.id)}
    />
  )
})()}
```

Note: `resumeVersions` is already fetched in `JobCard` via `getResumeVersions`. Check that the prop/state is available in the expanded section. If it comes from a local state, use that state variable name.

- [ ] **Step 5: Check `jdRaw` is available on the job prop**

In `src/lib/api.ts`, verify the `ScoredJob` interface has `jdRaw`. If not, check `src/db/schema.ts` — `jobs.jdRaw` exists. Trace the API response from `GET /api/jobs` to confirm `jdRaw` is returned. Add it to `ScoredJob` interface if missing.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output

- [ ] **Step 7: Run full test suite**

```bash
npm run test:run
```
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/components/applications/JobCard.tsx
git commit -m "feat(009): rename Generate Resume button, add JD guard, render TailoredResumeCard"
```

---

### Task 6: Per-Draft Timestamp Display

**Files:**
- Modify: `src/components/pipeline/EmailDraftCard.tsx`
- Modify: `src/components/pipeline/ManualSendDraftCard.tsx`

- [ ] **Step 1: Write failing test for EmailDraftCard timestamp row**

In `src/__tests__/components/pipeline/EmailDraftCard.test.tsx` (if it exists, add to it; otherwise note the gap):

```typescript
it('shows sent and opened timestamps when sentAt and openDetectedAt are set', () => {
  // Pass a draft with both sentAt and openDetectedAt set
  // Verify both dates appear in the rendered output
  render(
    <EmailDraftCard
      draft={{
        ...baseDraft,
        status: 'sent',
        sentAt: '2026-01-01T10:00:00Z',
        openDetectedAt: '2026-01-02T15:30:00Z',
      }}
      cadenceId="c1"
      onDraftApproved={vi.fn()}
      onDraftEdited={vi.fn()}
    />
  )
  expect(screen.getByText(/sent/i)).toBeInTheDocument()
  expect(screen.getByText(/opened/i)).toBeInTheDocument()
})

it('shows "Not opened yet" when sentAt is set but openDetectedAt is null', () => {
  render(
    <EmailDraftCard
      draft={{
        ...baseDraft,
        status: 'sent',
        sentAt: '2026-01-01T10:00:00Z',
        openDetectedAt: null,
      }}
      cadenceId="c1"
      onDraftApproved={vi.fn()}
      onDraftEdited={vi.fn()}
    />
  )
  expect(screen.getByText(/not opened yet/i)).toBeInTheDocument()
})

it('hides status row when sentAt is null', () => {
  render(
    <EmailDraftCard
      draft={{ ...baseDraft, status: 'draft', sentAt: null, openDetectedAt: null }}
      cadenceId="c1"
      onDraftApproved={vi.fn()}
      onDraftEdited={vi.fn()}
    />
  )
  expect(screen.queryByTestId('draft-send-status')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run src/__tests__/components/pipeline/EmailDraftCard.test.tsx
```
Expected: new tests FAIL

- [ ] **Step 3: Add status row to `EmailDraftCard`**

In `src/components/pipeline/EmailDraftCard.tsx`, find the `{draft.sentAt && ...}` block (around line 114) that shows the sent timestamp as plain text. Replace it with a richer status row:

```typescript
{draft.sentAt && (
  <div
    data-testid="draft-send-status"
    className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#475569]"
  >
    <span>
      ✉ Sent {new Date(draft.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
    </span>
    {draft.openDetectedAt ? (
      <span>
        👁 Opened {new Date(draft.openDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
      </span>
    ) : (
      <span className="text-[#334155]">Not opened yet</span>
    )}
    {draft.clickDetectedAt && (
      <span>
        → Clicked {new Date(draft.clickDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
      </span>
    )}
  </div>
)}
```

- [ ] **Step 4: Add status row to `ManualSendDraftCard`**

In `src/components/pipeline/ManualSendDraftCard.tsx`, the already-sent card (around lines 76-94) shows only the `sentAt` timestamp. Add the same status row pattern to `CardContent` of the sent card:

In the `if (isAlreadySent)` branch, after the `CardHeader`, add `CardContent` with the status row:

```typescript
if (isAlreadySent) {
  return (
    <Card className="border border-emerald-800/30 bg-emerald-950/10" data-testid={`manual-draft-day-${draft.dayNumber}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">
            {DAY_LABELS[draft.dayNumber]} — Sent
          </span>
        </div>
      </CardHeader>
      {draft.sentAt && (
        <CardContent className="pt-0 pb-2">
          <div
            data-testid="draft-send-status"
            className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#475569]"
          >
            <span>
              ✉ Sent {new Date(draft.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
            </span>
            {draft.openDetectedAt ? (
              <span>
                👁 Opened {new Date(draft.openDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
              </span>
            ) : (
              <span className="text-[#334155]">Not opened yet</span>
            )}
            {draft.clickDetectedAt && (
              <span>
                → Clicked {new Date(draft.clickDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
npx vitest run src/__tests__/components/pipeline/EmailDraftCard.test.tsx
```
Expected: all PASS

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add src/components/pipeline/EmailDraftCard.tsx src/components/pipeline/ManualSendDraftCard.tsx
git commit -m "feat(009): add sent/opened/clicked timestamp row to draft cards"
```

---

### Task 7: Verification Gate

**Files:** None — run commands only

- [ ] **Step 1: Run full test suite**

```bash
npm run test:run
```
Expected: all tests PASS, 0 failures

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: zero errors (no output)

- [ ] **Step 3: Production build**

```bash
npm run build
```
Expected: exit 0, no prerender errors

- [ ] **Step 4: Manual smoke test — TailoredResumeCard**
- Start dev server: `npm run dev`
- Navigate to a candidate in Pipeline view
- Approve a job that has a JD fetched
- Click "✨ Tailor for This Role" — `BuildProgressPane` should run
- On completion, `TailoredResumeCard` appears with keyword badges and archetype name
- Verify: View Resume and View Cover Letter buttons work

- [ ] **Step 5: Manual smoke test — stale warning**
- Generate a resume for a job
- Go to Settings → update CV (add any text)
- Return to Pipeline → job card should show "⚠ CV updated since tailoring"

- [ ] **Step 6: Manual smoke test — InsightsFunnelCard**
- Navigate to Dashboard
- `InsightsFunnelCard` renders below `JobSearchCard`
- If outreach exists: funnel counts and rates display correctly
- If no outreach: all rates show "—" and "Send your first email" message appears

- [ ] **Step 7: Manual smoke test — JD guard**
- Find or create a job with empty JD (`jdRaw` empty)
- "✨ Tailor for This Role" button is disabled with tooltip

- [ ] **Step 8: Manual smoke test — draft timestamps**
- Open Email Outreach Panel for a cadence with sent drafts
- Days with `sentAt` show "✉ Sent [date]" and open status
- Days without `sentAt` show no status row

- [ ] **Step 9: Commit verification results**

```bash
git add -p  # stage only verification-related changes if any
git commit -m "chore(009): verification gate complete — all checks pass"
```
