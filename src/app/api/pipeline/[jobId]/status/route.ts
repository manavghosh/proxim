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

    // When discovery_only completes, check if a fetch_jds job was auto-queued.
    // Return its ID so the dashboard can seamlessly continue tracking it.
    let followUpJobId: string | null = null
    if (job.status === 'completed' && job.jobType === 'discovery_only') {
      const [fetchJob] = await db
        .select({ id: pipelineJobs.id })
        .from(pipelineJobs)
        .where(
          and(
            eq(pipelineJobs.candidateId, job.candidateId),
            eq(pipelineJobs.jobType, 'fetch_jds'),
            or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running'))
          )
        )
        .orderBy(pipelineJobs.createdAt)
        .limit(1)
      followUpJobId = fetchJob?.id ?? null
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
