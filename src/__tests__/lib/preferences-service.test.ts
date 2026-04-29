import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergePreferences } from '@/lib/preferences-service'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

describe('mergePreferences', () => {
  it('merges new fields into existing preferences', () => {
    const result = mergePreferences(
      { seniority_levels: ['CAIO'] },
      { geographic_preference: ['Remote'] }
    )
    expect(result).toEqual({
      seniority_levels: ['CAIO'],
      geographic_preference: ['Remote'],
    })
  })

  it('overwrites existing fields with updated values', () => {
    const result = mergePreferences(
      { seniority_levels: ['CAIO'] },
      { seniority_levels: ['VP AI', 'Head of AI'] }
    )
    expect(result.seniority_levels).toEqual(['VP AI', 'Head of AI'])
  })

  it('does not clear fields that are not present in the update', () => {
    const result = mergePreferences(
      { seniority_levels: ['CAIO'], geographic_preference: ['Remote'] },
      { seniority_levels: ['VP AI'] }
    )
    expect(result.geographic_preference).toEqual(['Remote'])
  })

  it('returns a new object and does not mutate the original', () => {
    const existing = { seniority_levels: ['CAIO'] }
    mergePreferences(existing, { geographic_preference: ['Remote'] })
    expect(existing).toEqual({ seniority_levels: ['CAIO'] })
  })
})
