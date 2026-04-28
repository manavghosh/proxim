import { describe, it, expect } from 'vitest'
import { computeSHA256 } from '@/lib/hash'

describe('computeSHA256', () => {
  it('returns a 64-character lowercase hex string', () => {
    expect(computeSHA256('hello')).toHaveLength(64)
    expect(computeSHA256('hello')).toMatch(/^[0-9a-f]+$/)
  })

  it('returns the same hash for the same input', () => {
    expect(computeSHA256('hello world')).toBe(computeSHA256('hello world'))
  })

  it('returns different hashes for different inputs', () => {
    expect(computeSHA256('hello')).not.toBe(computeSHA256('hello!'))
  })

  it('returns the well-known SHA256 of an empty string', () => {
    expect(computeSHA256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })
})
