import { describe, it, expect } from 'vitest'
import { aggregateInsights } from '@/lib/insights-helpers'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const job1 = {
  id: 'j1',
  status: 'approved',
  archetype: 'Enterprise CAIO',
  archetypeConfidence: 0.9,
  interviewCallbackAt: null,
  grade: 'A',
}

const job2 = {
  id: 'j2',
  status: 'approved',
  archetype: 'Startup CTO',
  archetypeConfidence: 0.8,
  interviewCallbackAt: null,
  grade: 'B',
}

const cadence1 = { id: 'c1', jobId: 'j1', replyDetectedAt: null, status: 'active' }
const draft1Day1 = { id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: '2026-01-02T10:00:00Z' }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('aggregateInsights', () => {
  it('returns all-zero funnel with null rates when no data', () => {
    const result = aggregateInsights('cand-1', { jobs: [], cadences: [], drafts: [] })
    expect(result.funnel.discovered).toBe(0)
    expect(result.funnel.approved).toBe(0)
    expect(result.funnel.day1Sent).toBe(0)
    expect(result.funnel.opened).toBe(0)
    expect(result.funnel.replied).toBe(0)
    expect(result.funnel.callbacks).toBe(0)
    expect(result.rates.openRate).toBeNull()
    expect(result.rates.replyRate).toBeNull()
    expect(result.rates.abGradeRate).toBeNull()
    expect(result.rates.callbackRate).toBeNull()
    expect(result.archetypeBreakdown).toEqual([])
  })

  it('counts discovered jobs correctly', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [job1, job2],
      cadences: [],
      drafts: [],
    })
    expect(result.funnel.discovered).toBe(2)
    expect(result.funnel.approved).toBe(2)
  })

  it('computes open rate correctly', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [job1],
      cadences: [cadence1],
      drafts: [draft1Day1],
    })
    expect(result.funnel.day1Sent).toBe(1)
    expect(result.funnel.opened).toBe(1)
    expect(result.rates.openRate).toBeCloseTo(1.0)
  })

  it('excludes orphaned opens (openDetectedAt set but sentAt null)', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [job1],
      cadences: [cadence1],
      drafts: [{ id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: null, openDetectedAt: '2026-01-02T10:00:00Z' }],
    })
    expect(result.funnel.opened).toBe(0)
    expect(result.rates.openRate).toBeNull()
  })

  it('counts replied cadences including cancelled status', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [job1],
      cadences: [{ id: 'c1', jobId: 'j1', replyDetectedAt: '2026-01-03T10:00:00Z', status: 'cancelled' }],
      drafts: [{ id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: null }],
    })
    expect(result.funnel.replied).toBe(1)
  })

  it('deduplicates multiple Day 1 drafts per cadence (keeps most recent sentAt)', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [job1],
      cadences: [cadence1],
      drafts: [
        { id: 'd1', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T08:00:00Z', openDetectedAt: null },
        { id: 'd2', cadenceId: 'c1', dayNumber: 1, sentAt: '2026-01-01T10:00:00Z', openDetectedAt: null },
      ],
    })
    expect(result.funnel.day1Sent).toBe(1)
  })

  it('counts A/B grade jobs correctly for abGradeRate', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [
        { ...job1, grade: 'A' },
        { ...job2, grade: 'C' },
      ],
      cadences: [],
      drafts: [],
    })
    expect(result.rates.abGradeRate).toBeCloseTo(0.5)
  })

  it('counts interview callbacks', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [{ ...job1, interviewCallbackAt: '2026-01-05T10:00:00Z' }],
      cadences: [],
      drafts: [],
    })
    expect(result.funnel.callbacks).toBe(1)
    expect(result.rates.callbackRate).toBeCloseTo(1.0)
  })

  it('ranks archetype breakdown by replyRate descending', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [job1, job2],
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
    expect(result.archetypeBreakdown[0].replied).toBe(1)
    expect(result.archetypeBreakdown[1].archetype).toBe('Startup CTO')
    expect(result.archetypeBreakdown[1].replied).toBe(0)
  })

  it('hides archetype breakdown when fewer than 2 archetypes', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [job1],
      cadences: [],
      drafts: [],
    })
    expect(result.archetypeBreakdown).toEqual([])
  })

  it('excludes jobs with null archetype from breakdown', () => {
    const result = aggregateInsights('cand-1', {
      jobs: [
        { ...job1, archetype: null },
        { ...job2, archetype: null },
      ],
      cadences: [],
      drafts: [],
    })
    expect(result.archetypeBreakdown).toEqual([])
  })

  it('limits archetype breakdown to top 5', () => {
    const manyJobs = Array.from({ length: 7 }, (_, i) => ({
      id: `j${i}`,
      status: 'approved',
      archetype: `Archetype ${i}`,
      archetypeConfidence: 0.8,
      interviewCallbackAt: null,
      grade: 'A',
    }))
    const result = aggregateInsights('cand-1', {
      jobs: manyJobs,
      cadences: [],
      drafts: [],
    })
    expect(result.archetypeBreakdown.length).toBeLessThanOrEqual(5)
  })
})
