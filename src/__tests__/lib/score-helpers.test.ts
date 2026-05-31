import { describe, it, expect } from 'vitest'
import { extractStrengthsAndRisks } from '@/lib/score-helpers'

// score10d is persisted with snake_case keys — fixtures must match the real shape.
const d = (score: number) => ({ score, reasoning: '' })

const SCORE_10D = {
  gate: {
    role_level_match: d(5.0),
    ai_stack_alignment: d(4.5),
  },
  weighted: {
    compensation: d(4.0),
    company_stage: d(3.0),
    interview_probability: d(4.8),
    thought_leadership: d(2.5),
    geography: d(5.0),
    growth_trajectory: d(3.5),
    domain_resonance: d(2.0),
    hiring_urgency: d(1.5),
  },
}

describe('extractStrengthsAndRisks', () => {
  it('returns empty lists for null', () => {
    expect(extractStrengthsAndRisks(null)).toEqual({ strengths: [], risks: [] })
  })

  it('reads snake_case keys — parses more than just compensation/geography (regression)', () => {
    const { strengths, risks } = extractStrengthsAndRisks(SCORE_10D as never)
    const names = [...strengths, ...risks].map(x => x.name)
    // Before the fix, camelCase lookups left only Compensation + Geography.
    expect(names).toContain('Role Level Match')
    expect(names).toContain('Interview Probability')
    expect(names).toContain('Hiring Urgency')
  })

  it('picks the top 3 dimensions as strengths', () => {
    const { strengths } = extractStrengthsAndRisks(SCORE_10D as never)
    expect(strengths.map(s => s.name)).toEqual([
      'Role Level Match',     // 5.0
      'Geography',            // 5.0
      'Interview Probability' // 4.8
    ])
  })

  it('picks the lowest 2 weighted dimensions as risks', () => {
    const { risks } = extractStrengthsAndRisks(SCORE_10D as never)
    expect(risks.map(r => r.name)).toEqual([
      'Hiring Urgency',  // 1.5
      'Domain Resonance' // 2.0
    ])
  })

  it('never shows the same dimension as both a strength and a risk (no duplicates)', () => {
    const { strengths, risks } = extractStrengthsAndRisks(SCORE_10D as never)
    const strengthNames = new Set(strengths.map(s => s.name))
    for (const r of risks) {
      expect(strengthNames.has(r.name)).toBe(false)
    }
    const all = [...strengths, ...risks].map(x => x.name)
    expect(new Set(all).size).toBe(all.length)
  })
})
