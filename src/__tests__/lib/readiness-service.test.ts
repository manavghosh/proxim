import { describe, it, expect } from 'vitest'
import { computeReadiness } from '@/lib/readiness-service'
import type { Candidate } from '@/db/schema'

const base: Candidate = {
  id: 'test-id',
  name: 'Test Candidate',
  candidateId: null,
  baseCvMd: null,
  baseCvHash: null,
  baseResumePdfPath: null,
  parsedProfile: null,
  parseStatus: 'pending',
  preferences: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('computeReadiness', () => {
  it('returns ready: false and 3 missing items when candidate is null', () => {
    const result = computeReadiness(null)
    expect(result.ready).toBe(false)
    expect(result.missing).toHaveLength(3)
  })

  it('returns ready: false when only CV is saved', () => {
    const result = computeReadiness({ ...base, baseCvMd: '# CV' })
    expect(result.ready).toBe(false)
    expect(result.missing).toHaveLength(2)
  })

  it('returns ready: false when CV and seniority are set but location is missing', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: { seniority_levels: ['CAIO'] },
    })
    expect(result.ready).toBe(false)
    expect(result.missing.some((m) => /geographic/i.test(m))).toBe(true)
  })

  it('returns ready: true when CV, seniority, and location array are all set', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: {
        seniority_levels: ['CAIO'],
        geographic_preference: ['Remote'],
      },
    })
    expect(result.ready).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('returns ready: false when geographic_preference is an empty array', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: { seniority_levels: ['CAIO'], geographic_preference: [] },
    })
    expect(result.ready).toBe(false)
    expect(result.missing.some((m) => /geographic/i.test(m))).toBe(true)
  })

  it('returns ready: true when geographic_preference has multiple values', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: {
        seniority_levels: ['CAIO'],
        geographic_preference: ['Remote', 'Hybrid'],
      },
    })
    expect(result.ready).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('returns ready: false when seniority_levels is an empty array', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: { seniority_levels: [], geographic_preference: ['Remote'] },
    })
    expect(result.ready).toBe(false)
  })

  it('reports parseStatus from the candidate', () => {
    const result = computeReadiness({ ...base, parseStatus: 'ready' })
    expect(result.parseStatus).toBe('ready')
  })
})
