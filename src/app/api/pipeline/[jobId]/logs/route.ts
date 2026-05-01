import { NextResponse } from 'next/server'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs, pipelineLogs } from '@/db/schema'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const { searchParams } = new URL(request.url)
  const since = searchParams.get('since')

  try {
    const [job] = await db
      .select({ id: pipelineJobs.id, status: pipelineJobs.status, error: pipelineJobs.error })
      .from(pipelineJobs)
      .where(eq(pipelineJobs.id, jobId))
      .limit(1)

    if (!job) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const logs = await (since
      ? db.select().from(pipelineLogs)
          .where(and(eq(pipelineLogs.pipelineJobId, jobId), gt(pipelineLogs.createdAt, since as unknown as Date)))
          .orderBy(pipelineLogs.createdAt)
          .limit(100)
      : db.select().from(pipelineLogs)
          .where(eq(pipelineLogs.pipelineJobId, jobId))
          .orderBy(pipelineLogs.createdAt)
          .limit(100))

    return NextResponse.json({
      logs,
      jobStatus: job.status,
      jobError: job.error,
    })
  } catch (e) {
    console.error('[pipeline/logs] error:', e)
    return NextResponse.json({ logs: [], jobStatus: 'unknown', jobError: null }, { status: 200 })
  }
}
