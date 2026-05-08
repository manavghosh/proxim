import { describe, it, expect } from 'vitest'
import { groupByPosition } from '@/lib/position-normalizer'

type JobRow = { id: string; title: string; company: string }

const job = (id: string, title: string, company: string): JobRow => ({ id, title, company })

describe('groupByPosition', () => {
  it('returns an empty result for an empty input', () => {
    expect(groupByPosition([])).toEqual({ totalJobs: 0, groups: [] })
  })

  it('produces a single group for a single job', () => {
    const result = groupByPosition([job('j1', 'Director', 'Acme')])
    expect(result.totalJobs).toBe(1)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toEqual({
      position: 'Director',
      rawTitles: ['Director'],
      count: 1,
      jobIds: ['j1'],
      sampleCompanies: ['Acme'],
    })
  })

  it('groups two jobs with the same exact title', () => {
    const result = groupByPosition([
      job('j1', 'Director', 'Acme'),
      job('j2', 'Director', 'Globex'),
    ])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].count).toBe(2)
    expect(result.groups[0].jobIds).toEqual(['j1', 'j2'])
    expect(result.groups[0].sampleCompanies).toEqual(['Acme', 'Globex'])
  })

  it('groups variants that normalize to the same position', () => {
    const result = groupByPosition([
      job('j1', 'Sr. Director', 'Acme'),
      job('j2', 'Senior Director, AI', 'Globex'),
      job('j3', 'sr director - enterprise', 'Initech'),
    ])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].position).toBe('Senior Director')
    expect(result.groups[0].count).toBe(3)
    expect(result.groups[0].rawTitles).toEqual([
      'Sr. Director',
      'Senior Director, AI',
      'sr director - enterprise',
    ])
  })

  it('produces multiple groups for distinct positions', () => {
    const result = groupByPosition([
      job('j1', 'Director', 'Acme'),
      job('j2', 'Data Analyst', 'Globex'),
    ])
    expect(result.groups).toHaveLength(2)
  })

  it('sorts groups by count desc, then alphabetically by position', () => {
    const result = groupByPosition([
      job('j1', 'Data Analyst', 'A'),
      job('j2', 'Director', 'B'),
      job('j3', 'Director', 'C'),
      job('j4', 'AI Leader', 'D'),
      job('j5', 'AI Leader', 'E'),
    ])
    // Director: 2, AI Leader: 2, Data Analyst: 1
    // Tied counts → alphabetical: AI Leader before Director
    expect(result.groups.map((g) => g.position)).toEqual([
      'AI Leader',
      'Director',
      'Data Analyst',
    ])
  })

  it('dedupes rawTitles within a group while preserving first-seen order', () => {
    const result = groupByPosition([
      job('j1', 'Director', 'A'),
      job('j2', 'director', 'B'),
      job('j3', 'Director', 'C'),
    ])
    expect(result.groups[0].rawTitles).toEqual(['Director', 'director'])
  })

  it('caps sampleCompanies at 3 entries and dedupes', () => {
    const result = groupByPosition([
      job('j1', 'Director', 'A'),
      job('j2', 'Director', 'B'),
      job('j3', 'Director', 'A'),
      job('j4', 'Director', 'C'),
      job('j5', 'Director', 'D'),
    ])
    expect(result.groups[0].sampleCompanies).toEqual(['A', 'B', 'C'])
  })

  it('preserves jobIds in input order within a group', () => {
    const result = groupByPosition([
      job('j3', 'Director', 'A'),
      job('j1', 'Director', 'B'),
      job('j2', 'Director', 'C'),
    ])
    expect(result.groups[0].jobIds).toEqual(['j3', 'j1', 'j2'])
  })

  it('totals count across all groups', () => {
    const result = groupByPosition([
      job('j1', 'Director', 'A'),
      job('j2', 'Director', 'B'),
      job('j3', 'Data Analyst', 'C'),
    ])
    expect(result.totalJobs).toBe(3)
    const sum = result.groups.reduce((a, g) => a + g.count, 0)
    expect(sum).toBe(3)
  })

  it('routes empty/missing titles into the "Unknown" group', () => {
    const result = groupByPosition([
      job('j1', '', 'A'),
      job('j2', '   ', 'B'),
    ])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].position).toBe('Unknown')
    expect(result.groups[0].count).toBe(2)
  })
})
