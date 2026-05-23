import { describe, it, expect } from 'vitest'
import {
  computeRatePercent,
  countInProgress,
  aggregateRunTotals,
  buildZeroMetrics,
} from '@/lib/analytics-service'

describe('computeRatePercent', () => {
  it('returns null when denominator is zero', () => {
    expect(computeRatePercent(5, 0)).toBeNull()
  })

  it('returns null when denominator is negative', () => {
    expect(computeRatePercent(1, -1)).toBeNull()
  })

  it('returns 0 when numerator is zero and denominator is positive', () => {
    expect(computeRatePercent(0, 10)).toBe(0)
  })

  it('returns 50 for half proportion', () => {
    expect(computeRatePercent(5, 10)).toBe(50)
  })

  it('returns 100 when numerator equals denominator', () => {
    expect(computeRatePercent(10, 10)).toBe(100)
  })

  it('rounds to nearest integer', () => {
    expect(computeRatePercent(1, 3)).toBe(33)
    expect(computeRatePercent(2, 3)).toBe(67)
  })
})

describe('countInProgress', () => {
  it('returns 0 for empty array', () => {
    expect(countInProgress([])).toBe(0)
  })

  it('returns 0 when no runs are running or queued', () => {
    const runs = [
      { status: 'completed' },
      { status: 'failed' },
    ]
    expect(countInProgress(runs)).toBe(0)
  })

  it('counts running and queued as in-progress', () => {
    const runs = [
      { status: 'running' },
      { status: 'queued' },
      { status: 'completed' },
      { status: 'failed' },
    ]
    expect(countInProgress(runs)).toBe(2)
  })
})

describe('aggregateRunTotals', () => {
  it('returns zeroed totals for empty runs array', () => {
    const result = aggregateRunTotals([])
    expect(result.totalJobsDiscovered).toBe(0)
    expect(result.totalAbGradeCount).toBe(0)
    expect(result.totalEmailsSent).toBe(0)
    expect(result.totalRepliesReceived).toBe(0)
  })

  it('sums all runs correctly', () => {
    const runs = [
      { jobsDiscovered: 10, abGradeCount: 3, emailsSent: 2, repliesReceived: 1, resumesGenerated: 2 },
      { jobsDiscovered: 20, abGradeCount: 5, emailsSent: 4, repliesReceived: 2, resumesGenerated: 4 },
    ]
    const result = aggregateRunTotals(runs)
    expect(result.totalJobsDiscovered).toBe(30)
    expect(result.totalAbGradeCount).toBe(8)
    expect(result.totalEmailsSent).toBe(6)
    expect(result.totalRepliesReceived).toBe(3)
  })
})

describe('buildZeroMetrics', () => {
  it('returns all-zero metrics with null rates', () => {
    const result = buildZeroMetrics()
    expect(result.totalJobsDiscovered).toBe(0)
    expect(result.abGradeRate).toBeNull()
    expect(result.emailOpenRate).toBeNull()
    expect(result.emailReplyRate).toBeNull()
    expect(result.linkedInAcceptRate).toBeNull()
    expect(result.interviewCallbackRate).toBeNull()
    expect(result.totalRuns).toBe(0)
    expect(result.inProgressRuns).toBe(0)
  })

  it('returns zeroed grade distribution', () => {
    const result = buildZeroMetrics()
    expect(result.gradeDistribution).toEqual({ A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 })
  })
})
