import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
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

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      jobType: job.jobType,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      pipelineRun: run ?? null,
    })
  } catch (e) {
    console.error('[pipeline/status] error:', e)
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 })
  }
}
