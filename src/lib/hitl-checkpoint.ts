import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { hitlCheckpoints } from '@/db/schema'

export interface HitlCheckpointInput {
  jobId: string
  candidateId: string
  status: 'awaiting' | 'approved' | 'rejected' | 'snoozed'
  decisionType?: string | null
  snoozedUntil?: Date | null
  decidedAt?: Date | null
}

export async function upsertHitlCheckpoint(input: HitlCheckpointInput): Promise<string> {
  const { jobId, candidateId, status, decisionType, snoozedUntil, decidedAt } = input

  // Why we populate id + timestamps in JS instead of relying on the PG
  // schema's defaultRandom() / defaultNow():
  //   - On SQLite (local dev) those defaults emit `gen_random_uuid()` /
  //     `now()` which SQLite doesn't have, so the prepared statement fails.
  //   - Date objects can't be bound directly by better-sqlite3 (it accepts
  //     numbers / strings / bigints / buffers / null only), so we pass ISO
  //     strings — Postgres's timestamp column accepts those just fine.
  // The `as never` cast is because the PG schema types these fields as Date,
  // but at runtime both backends accept the ISO string equivalently.
  const newId = randomUUID()
  const nowIso = new Date().toISOString()
  const decidedIso = decidedAt ? decidedAt.toISOString() : null
  const snoozedIso = snoozedUntil ? snoozedUntil.toISOString() : null

  const [row] = await db
    .insert(hitlCheckpoints)
    .values({
      id: newId,
      jobId,
      candidateId,
      status,
      decisionType: decisionType ?? null,
      snoozedUntil: snoozedIso as never,
      decidedAt: decidedIso as never,
      createdAt: nowIso as never,
    })
    .onConflictDoUpdate({
      target: hitlCheckpoints.jobId,
      set: {
        status,
        decisionType: decisionType ?? null,
        snoozedUntil: snoozedIso as never,
        decidedAt: decidedIso as never,
      },
    })
    .returning({ id: hitlCheckpoints.id })

  return row.id
}
