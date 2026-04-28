import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Candidate } from '@/db/schema'
import { computeSHA256 } from '@/lib/hash'

export function shouldTriggerParse(
  existingHash: string | null | undefined,
  newHash: string
): boolean {
  return existingHash !== newHash
}

export async function getOrCreateCandidate(): Promise<Candidate> {
  const [existing] = await db.select().from(candidates).limit(1)
  if (existing) return existing
  const [created] = await db.insert(candidates).values({}).returning()
  return created
}

export async function saveCVMarkdown(
  markdown: string
): Promise<{ candidate: Candidate; hashChanged: boolean }> {
  const newHash = computeSHA256(markdown)
  const candidate = await getOrCreateCandidate()

  if (!shouldTriggerParse(candidate.baseCvHash, newHash)) {
    return { candidate, hashChanged: false }
  }

  const [updated] = await db
    .update(candidates)
    .set({
      baseCvMd: markdown,
      baseCvHash: newHash,
      parseStatus: 'parsing',
      parsedProfile: null,
    })
    .where(eq(candidates.id, candidate.id))
    .returning()

  return { candidate: updated, hashChanged: true }
}

export async function markParseReady(
  candidateId: string,
  parsedProfile: unknown
): Promise<void> {
  await db
    .update(candidates)
    .set({ parseStatus: 'ready', parsedProfile: parsedProfile as never })
    .where(eq(candidates.id, candidateId))
}

export async function markParseFailed(candidateId: string): Promise<void> {
  await db
    .update(candidates)
    .set({ parseStatus: 'failed' })
    .where(eq(candidates.id, candidateId))
}
