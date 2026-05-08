import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'

export function mergePreferences(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  return { ...existing, ...updates }
}

export async function getPreferences(candidateId?: string): Promise<Record<string, unknown>> {
  const query = candidateId
    ? db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1)
    : db.select().from(candidates).limit(1)
  const [candidate] = await query
  return (candidate?.preferences as Record<string, unknown>) ?? {}
}

export async function updatePreferences(
  updates: Record<string, unknown>,
  candidateId?: string
): Promise<Record<string, unknown>> {
  const query = candidateId
    ? db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1)
    : db.select().from(candidates).limit(1)
  const [candidate] = await query

  if (!candidate) {
    const [created] = await db
      .insert(candidates)
      .values({ preferences: updates })
      .returning()
    return created.preferences as Record<string, unknown>
  }

  const merged = mergePreferences(
    candidate.preferences as Record<string, unknown>,
    updates
  )

  const [updated] = await db
    .update(candidates)
    .set({ preferences: merged })
    .where(eq(candidates.id, candidate.id))
    .returning()

  return updated.preferences as Record<string, unknown>
}
