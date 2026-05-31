import { NextResponse } from 'next/server'
import { and, eq, ne, or } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs } from '@/db/schema'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  try {
    const [job] = await db
      .select({ id: pipelineJobs.id, status: pipelineJobs.status, jobType: pipelineJobs.jobType, candidateId: pipelineJobs.candidateId })
      .from(pipelineJobs)
      .where(eq(pipelineJobs.id, jobId))
      .limit(1)

    if (!job) {
      return NextResponse.json({ error: 'Pipeline job not found' }, { status: 404 })
    }

    if (!['queued', 'running'].includes(job.status)) {
      return NextResponse.json(
        { error: `Job is already in terminal state: ${job.status}` },
        { status: 409 },
      )
    }

    await db
      .update(pipelineJobs)
      .set({
        status: 'failed',
        error: 'Cancelled by user',
        completedAt: new Date(),
      })
      .where(
        and(
          eq(pipelineJobs.id, jobId),
          or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running')),
        ),
      )

    // When a scoring job is cancelled, also cancel any OTHER queued score_jobs for
    // this candidate. This prevents auto-queued scoring batches (e.g. from import_jobs)
    // from starting after the user explicitly cancelled, re-scoring the same jobs.
    if (job.jobType === 'score_jobs') {
      await db
        .update(pipelineJobs)
        .set({ status: 'failed', error: 'Cancelled — scoring batch cancelled by user' })
        .where(
          and(
            eq(pipelineJobs.candidateId, job.candidateId),
            eq(pipelineJobs.jobType, 'score_jobs'),
            eq(pipelineJobs.status, 'queued'),
            ne(pipelineJobs.id, jobId),
          ),
        )
    }

    return NextResponse.json({ jobId, cancelled: true })
  } catch (e) {
    console.error('[pipeline/cancel] error:', e)
    return NextResponse.json({ error: 'Failed to cancel job' }, { status: 500 })
  }
}
