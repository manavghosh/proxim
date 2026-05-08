import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'
import { upsertHitlCheckpoint } from '@/lib/hitl-checkpoint'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }

    const updated = await db
      .update(jobs)
      .set({ status: 'awaiting' })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'snoozed')))
      .returning({ id: jobs.id, status: jobs.status })

    if (updated.length === 0) {
      const current = await db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      return NextResponse.json(
        { error: 'Job is not snoozed', currentStatus: current[0]?.status },
        { status: 409 }
      )
    }

    const checkpointId = await upsertHitlCheckpoint({
      jobId,
      candidateId,
      status: 'awaiting',
      decisionType: null,
      snoozedUntil: null,
    })

    return NextResponse.json({ jobId, status: 'awaiting', checkpointId })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/unsnooze] POST error:', e)
    return NextResponse.json({ error: 'Failed to unsnooze job' }, { status: 500 })
  }
}
