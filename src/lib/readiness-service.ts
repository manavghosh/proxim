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

export async function getReadiness(candidateId?: string): Promise<ReadinessResult> {
  const { db } = await import('@/db')
  const { candidates } = await import('@/db/schema')
  const { eq } = await import('drizzle-orm')
  const query = candidateId
    ? db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1)
    : db.select().from(candidates).limit(1)
  const [candidate] = await query
  return computeReadiness(candidate ?? null)
}
