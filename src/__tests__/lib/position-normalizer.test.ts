import { describe, it, expect } from 'vitest'
import { normalizePosition } from '@/lib/position-normalizer'

describe('normalizePosition', () => {
  describe('empty / whitespace input', () => {
    it('returns "Unknown" for an empty string', () => {
      expect(normalizePosition('')).toBe('Unknown')
    })

    it('returns "Unknown" for whitespace-only input', () => {
      expect(normalizePosition('   ')).toBe('Unknown')
    })

    it('returns "Unknown" for a tab/newline-only input', () => {
      expect(normalizePosition('\t\n  ')).toBe('Unknown')
    })
  })

  describe('whitespace + casing', () => {
    it('trims leading and trailing whitespace', () => {
      expect(normalizePosition('  Director  ')).toBe('Director')
    })

    it('collapses multiple internal spaces', () => {
      expect(normalizePosition('Senior   Director')).toBe('Senior Director')
    })

    it('title-cases an all-lowercase title', () => {
      expect(normalizePosition('director')).toBe('Director')
    })

    it('title-cases an ALL-CAPS title (non-acronym word)', () => {
      expect(normalizePosition('DIRECTOR')).toBe('Director')
    })

    it('title-cases mixed-case titles', () => {
      expect(normalizePosition('sEnIoR dIrEcToR')).toBe('Senior Director')
    })
  })

  describe('seniority canonicalization', () => {
    it('expands "Sr." to "Senior"', () => {
      expect(normalizePosition('Sr. Director')).toBe('Senior Director')
    })

    it('expands "Sr" (no period) to "Senior"', () => {
      expect(normalizePosition('Sr Director')).toBe('Senior Director')
    })

    it('expands "Jr." to "Junior"', () => {
      expect(normalizePosition('Jr. Engineer')).toBe('Junior Engineer')
    })

    it('expands "Jr" (no period) to "Junior"', () => {
      expect(normalizePosition('Jr Engineer')).toBe('Junior Engineer')
    })

    it('does not expand "Sr" mid-word (e.g. inside another token)', () => {
      expect(normalizePosition('Manager')).toBe('Manager')
    })
  })

  describe('trailing modifier stripping', () => {
    it('strips a comma-separated specialization', () => {
      expect(normalizePosition('Senior Director, AI')).toBe('Senior Director')
    })

    it('strips a hyphen-separated specialization (" - ")', () => {
      expect(normalizePosition('Senior Director - AI Engineering')).toBe('Senior Director')
    })

    it('strips an em-dash-separated specialization', () => {
      expect(normalizePosition('Senior Director — AI')).toBe('Senior Director')
    })

    it('does not strip a word-internal hyphen (e.g. "co-founder")', () => {
      expect(normalizePosition('Co-Founder')).toBe('Co-Founder')
    })

    it('strips both seniority and modifier in one pass', () => {
      expect(normalizePosition('Sr. Director, Enterprise AI')).toBe('Senior Director')
    })
  })

  describe('common acronym preservation', () => {
    it('preserves "VP" as uppercase', () => {
      expect(normalizePosition('VP of Engineering')).toBe('VP of Engineering')
    })

    it('preserves "AI" as uppercase', () => {
      expect(normalizePosition('AI Leader')).toBe('AI Leader')
    })

    it('preserves "CTO" as uppercase', () => {
      expect(normalizePosition('CTO')).toBe('CTO')
    })

    it('preserves "SVP" as uppercase', () => {
      expect(normalizePosition('SVP Product')).toBe('SVP Product')
    })

    it('does not over-apply: "Director" stays as "Director" (not all-caps)', () => {
      expect(normalizePosition('director')).toBe('Director')
    })

    it('keeps short prepositions ("of", "and", "the") lowercase', () => {
      expect(normalizePosition('Head of AI')).toBe('Head of AI')
    })
  })

  describe('idempotency', () => {
    it('produces the same output when applied twice', () => {
      const once = normalizePosition('Sr. Director, AI')
      const twice = normalizePosition(once)
      expect(twice).toBe(once)
    })

    it('produces the same output for already-canonical input', () => {
      expect(normalizePosition('Senior Director')).toBe('Senior Director')
    })
  })

  describe('representative real-world examples', () => {
    it('Enterprise Architect, Cloud → Enterprise Architect', () => {
      expect(normalizePosition('Enterprise Architect, Cloud')).toBe('Enterprise Architect')
    })

    it('Data Analyst stays as-is', () => {
      expect(normalizePosition('Data Analyst')).toBe('Data Analyst')
    })

    it('Sr. Data Analyst → Senior Data Analyst', () => {
      expect(normalizePosition('Sr. Data Analyst')).toBe('Senior Data Analyst')
    })
  })
})
