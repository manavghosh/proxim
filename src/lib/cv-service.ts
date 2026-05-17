import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Candidate } from '@/db/schema'
import { computeSHA256 } from '@/lib/hash'

export function canReparse(candidate: Candidate | null): boolean {
  return Boolean(candidate?.baseCvMd) && candidate?.parseStatus !== 'parsing'
}

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

export async function getCandidateById(id: string): Promise<Candidate | null> {
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, id))
  return candidate ?? null
}

export async function saveCVMarkdown(
  markdown: string,
  candidateId?: string
): Promise<{ candidate: Candidate; hashChanged: boolean }> {
  const newHash = computeSHA256(markdown)
  const candidate = candidateId
    ? (await getCandidateById(candidateId)) ?? await getOrCreateCandidate()
    : await getOrCreateCandidate()

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

// Default placeholder used when a candidate is created without a name. We only
// auto-promote the parsed CV name onto candidates.name when the current name
// is still this placeholder — i.e. the user never typed one — so we don't
// silently overwrite a name they chose deliberately.
const PLACEHOLDER_NAME = 'New Candidate'

export async function markParseReady(
  candidateId: string,
  parsedProfile: unknown
): Promise<void> {
  const updates: { parseStatus: 'ready'; parsedProfile: never; name?: string } = {
    parseStatus: 'ready',
    parsedProfile: parsedProfile as never,
  }

  // If the row still has the placeholder name and the parsed profile has a
  // real name, promote it so the candidate card / sidebar / dashboard show
  // the actual person rather than "New Candidate".
  const profile = parsedProfile as { name?: unknown } | null
  const parsedName = typeof profile?.name === 'string' ? profile.name.trim() : ''
  if (parsedName) {
    const [existing] = await db
      .select({ name: candidates.name })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
    if (existing && existing.name === PLACEHOLDER_NAME) {
      updates.name = parsedName
    }
  }

  await db.update(candidates).set(updates).where(eq(candidates.id, candidateId))
}

export async function markParseFailed(candidateId: string): Promise<void> {
  await db
    .update(candidates)
    .set({ parseStatus: 'failed' })
    .where(eq(candidates.id, candidateId))
}
