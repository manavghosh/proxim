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

  const [row] = await db
    .insert(hitlCheckpoints)
    .values({
      jobId,
      candidateId,
      status,
      decisionType: decisionType ?? null,
      snoozedUntil: snoozedUntil ?? null,
      decidedAt: decidedAt ?? null,
    })
    .onConflictDoUpdate({
      target: hitlCheckpoints.jobId,
      set: {
        status,
        decisionType: decisionType ?? null,
        snoozedUntil: snoozedUntil ?? null,
        decidedAt: decidedAt ?? null,
      },
    })
    .returning({ id: hitlCheckpoints.id })

  return row.id
}
