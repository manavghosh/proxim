import { describe, it, expect, vi } from 'vitest'

// Mock the DB module so the module-level neon() call doesn't require a real
// DATABASE_URL in the unit test environment. shouldTriggerParse is pure and
// never touches the DB; the mock just allows the module to load.
vi.mock('@/db', () => ({ db: {} }))

import { shouldTriggerParse, canReparse } from '@/lib/cv-service'
import type { Candidate } from '@/db/schema'

const base: Candidate = {
  id: 'test-id',
  candidateId: null,
  baseCvMd: null,
  baseCvHash: null,
  parsedProfile: null,
  parseStatus: 'pending',
  preferences: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('canReparse', () => {
  it('returns false when there is no CV content', () => {
    expect(canReparse({ ...base, baseCvMd: null })).toBe(false)
  })

  it('returns false when parseStatus is parsing', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'parsing' })).toBe(false)
  })

  it('returns true when CV is saved and parseStatus is failed', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'failed' })).toBe(true)
  })

  it('returns true when CV is saved and parseStatus is pending', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'pending' })).toBe(true)
  })

  it('returns true when CV is saved and parseStatus is ready', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'ready' })).toBe(true)
  })
})

// shouldTriggerParse is a pure function — no DB calls involved
describe('shouldTriggerParse', () => {
  it('returns true when the existing hash is null', () => {
    expect(shouldTriggerParse(null, 'abc123')).toBe(true)
  })

  it('returns true when the existing hash is undefined', () => {
    expect(shouldTriggerParse(undefined, 'abc123')).toBe(true)
  })

  it('returns true when the hash has changed', () => {
    expect(shouldTriggerParse('old-hash', 'new-hash')).toBe(true)
  })

  it('returns false when the hash is identical', () => {
    expect(shouldTriggerParse('same-hash', 'same-hash')).toBe(false)
  })
})
