import { describe, it, expect } from 'vitest'
import { parseSeniorityText, sidebarRoleLabel } from '@/lib/preferences-helpers'

describe('parseSeniorityText', () => {
  it('splits newline-separated keywords into a trimmed array', () => {
    expect(parseSeniorityText('CAIO\nCTO')).toEqual(['CAIO', 'CTO'])
  })

  it('trims whitespace from each line', () => {
    expect(parseSeniorityText('  CAIO  \n  VP AI  ')).toEqual(['CAIO', 'VP AI'])
  })

  it('filters out blank lines', () => {
    expect(parseSeniorityText('CAIO\n\n\nCTO')).toEqual(['CAIO', 'CTO'])
  })

  it('returns an empty array for an empty string', () => {
    expect(parseSeniorityText('')).toEqual([])
  })

  it('returns an empty array for whitespace-only input', () => {
    expect(parseSeniorityText('   \n   ')).toEqual([])
  })
})

describe('sidebarRoleLabel', () => {
  it('returns the single level when only one is set', () => {
    expect(sidebarRoleLabel(['CAIO'])).toBe('CAIO')
  })

  it('returns first level + count when multiple are set', () => {
    expect(sidebarRoleLabel(['CAIO', 'CTO', 'VP AI'])).toBe('CAIO +2')
  })

  it('returns "Candidate" when the array is empty', () => {
    expect(sidebarRoleLabel([])).toBe('Candidate')
  })
})
