import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs, pipelineRuns } from '@/db/schema'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params

    const rows = await db
      .select({
        completedAt: pipelineRuns.completedAt,
        jobsDiscovered: pipelineRuns.jobsDiscovered,
        jobsDeduplicated: pipelineRuns.jobsDeduplicated,
      })
      .from(pipelineRuns)
      .innerJoin(pipelineJobs, eq(pipelineRuns.pipelineJobId, pipelineJobs.id))
      .where(
        and(
          eq(pipelineJobs.candidateId, candidateId),
          eq(pipelineJobs.jobType, 'discovery_only'),
          eq(pipelineRuns.status, 'completed'),
        )
      )
      .orderBy(desc(pipelineRuns.completedAt))
      .limit(1)

    if (rows.length === 0) {
      return NextResponse.json({
        lastSearchAt: null,
        jobsDiscovered: null,
        newJobs: null,
        duplicatesSkipped: null,
      })
    }

    const run = rows[0]
    const lastSearchAt = run.completedAt ? String(run.completedAt) : null
    const jobsDiscovered = run.jobsDiscovered
    const duplicatesSkipped = run.jobsDeduplicated
    const newJobs = Math.max(0, jobsDiscovered - duplicatesSkipped)

    return NextResponse.json({ lastSearchAt, jobsDiscovered, newJobs, duplicatesSkipped })
  } catch (e) {
    console.error('[last-search] error:', e)
    return NextResponse.json(
      { error: 'Failed to load last search data' },
      { status: 500 }
    )
  }
}
