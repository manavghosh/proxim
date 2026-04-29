import type { Candidate } from '@/db/schema'

export interface ReadinessResult {
  ready: boolean
  missing: string[]
  parseStatus: string
}

export function computeReadiness(candidate: Candidate | null): ReadinessResult {
  const prefs = (candidate?.preferences ?? {}) as Record<string, unknown>

  const cvSaved = Boolean(candidate?.baseCvMd)
  const senioritySet =
    Array.isArray(prefs.seniority_levels) &&
    (prefs.seniority_levels as string[]).length > 0
  const locationSet = Array.isArray(prefs.geographic_preference) && (prefs.geographic_preference as string[]).length > 0

  const missing: string[] = []
  if (!cvSaved) missing.push('Upload and save your CV')
  if (!senioritySet) missing.push('Set your target seniority level')
  if (!locationSet) missing.push('Set your geographic preference')

  return {
    ready: cvSaved && senioritySet && locationSet,
    missing,
    parseStatus: candidate?.parseStatus ?? 'pending',
  }
}

export async function getReadiness(): Promise<ReadinessResult> {
  const { db } = await import('@/db')
  const { candidates } = await import('@/db/schema')
  const [candidate] = await db.select().from(candidates).limit(1)
  return computeReadiness(candidate ?? null)
}
