import { NextResponse } from 'next/server'
import { and, eq, or } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs, pipelineRuns } from '@/db/schema'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  try {
    const [job] = await db
      .select()
      .from(pipelineJobs)
      .where(eq(pipelineJobs.id, jobId))
      .limit(1)

    if (!job) {
      return NextResponse.json({ error: 'Pipeline job not found' }, { status: 404 })
    }

    const [run] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.pipelineJobId, jobId))
      .orderBy(pipelineRuns.startedAt)
      .limit(1)

    // When a job completes, chain to the next auto-queued follow-up job.
    // discovery_only → fetch_jds → score_jobs
    let followUpJobId: string | null = null
    if (job.status === 'completed') {
      const nextTypes =
        job.jobType === 'discovery_only' ? ['fetch_jds', 'score_jobs']
        : job.jobType === 'fetch_jds'    ? ['score_jobs']
        : job.jobType === 'import_jobs'  ? ['score_jobs']
        : []

      for (const nextType of nextTypes) {
        const [nextJob] = await db
          .select({ id: pipelineJobs.id })
          .from(pipelineJobs)
          .where(
            and(
              eq(pipelineJobs.candidateId, job.candidateId),
              eq(pipelineJobs.jobType, nextType),
              or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running'))
            )
          )
          .orderBy(pipelineJobs.createdAt)
          .limit(1)
        if (nextJob) {
          followUpJobId = nextJob.id
          break
        }
      }
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      jobType: job.jobType,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      pipelineRun: run ?? null,
      followUpJobId,
    })
  } catch (e) {
    console.error('[pipeline/status] error:', e)
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 })
  }
}
