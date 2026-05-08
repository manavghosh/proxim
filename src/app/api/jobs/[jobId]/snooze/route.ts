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

    let days = 7
    try {
      const body = await request.json() as { days?: number }
      if (typeof body.days === 'number' && body.days > 0) days = body.days
    } catch {
      // empty body is fine — use default 7 days
    }

    const snoozedUntil = new Date(Date.now() + days * 86400000)

    const updated = await db
      .update(jobs)
      .set({ status: 'snoozed' })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['scored', 'awaiting'] as JobStatus[])))
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
      status: 'snoozed',
      decisionType: 'snooze',
      snoozedUntil,
    })

    return NextResponse.json({
      jobId,
      status: 'snoozed',
      snoozedUntil: snoozedUntil.toISOString(),
      checkpointId,
    })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/snooze] POST error:', e)
    return NextResponse.json({ error: 'Failed to snooze job' }, { status: 500 })
  }
}
