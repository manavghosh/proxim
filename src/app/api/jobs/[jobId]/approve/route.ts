import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs } from '@/db/schema'
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

    // Conditional UPDATE — only succeeds if job is in an approvable state
    const updated = await db
      .update(jobs)
      .set({ status: 'approved' })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['scored', 'awaiting'] as JobStatus[])))
      .returning({ id: jobs.id, status: jobs.status })

    if (updated.length === 0) {
      // Fetch current status to give a meaningful error
      const current = await db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)

      const currentStatus = current[0]?.status
      if (currentStatus && ['approved', 'rejected', 'snoozed'].includes(currentStatus)) {
        return NextResponse.json(
          { error: 'Job already decided', currentStatus },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: "Job must be in 'awaiting' or 'scored' status to approve" },
        { status: 422 }
      )
    }

    const checkpointId = await upsertHitlCheckpoint({
      jobId,
      candidateId,
      status: 'approved',
      decisionType: 'approve',
      decidedAt: new Date(),
    })

    const [pjob] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'resume_builder',
        candidateId,
        payload: { job_id: jobId, candidate_id: candidateId },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({
      jobId,
      status: 'approved',
      pipelineJobId: pjob.id,
      checkpointId,
    })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/approve] POST error:', e)
    return NextResponse.json({ error: 'Failed to approve job' }, { status: 500 })
  }
}
