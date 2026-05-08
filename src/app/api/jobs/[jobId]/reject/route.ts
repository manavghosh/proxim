import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'
import { upsertHitlCheckpoint } from '@/lib/hitl-checkpoint'

type JobStatus = 'awaiting' | 'approved' | 'rejected' | 'snoozed' | 'discovered' | 'scored' | 'score_failed' | 'resume_failed' | 'resume_ready' | 'submitted'

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
      .set({ status: 'rejected' })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['scored', 'awaiting', 'snoozed'] as JobStatus[])))
      .returning({ id: jobs.id, status: jobs.status })

    if (updated.length === 0) {
      const current = await db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)

      const currentStatus = current[0]?.status
      return NextResponse.json(
        { error: 'Job already decided', currentStatus },
        { status: 409 }
      )
    }

    const checkpointId = await upsertHitlCheckpoint({
      jobId,
      candidateId,
      status: 'rejected',
      decisionType: 'reject',
      decidedAt: new Date(),
    })

    return NextResponse.json({ jobId, status: 'rejected', checkpointId })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/reject] POST error:', e)
    return NextResponse.json({ error: 'Failed to reject job' }, { status: 500 })
  }
}
