import { describe, it, expect, vi } from 'vitest'

// Mock the DB module so the module-level neon() call doesn't require a real
// DATABASE_URL in the unit test environment. shouldTriggerParse is pure and
// never touches the DB; the mock just allows the module to load.
vi.mock('@/db', () => ({ db: {} }))

import { shouldTriggerParse } from '@/lib/cv-service'

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
