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
      // Inner join is needed to filter by jobType, which only exists on pipelineJobs
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
    // completedAt is a Date on Neon (pg) and a string on SQLite — new Date() handles both
    const lastSearchAt = run.completedAt ? new Date(run.completedAt).toISOString() : null
    const newJobs = run.jobsDiscovered
    const jobsDiscovered = run.jobsDiscovered
    const duplicatesSkipped = run.jobsDeduplicated

    return NextResponse.json({ lastSearchAt, jobsDiscovered, newJobs, duplicatesSkipped })
  } catch (e) {
    console.error('[last-search] error:', e)
    return NextResponse.json(
      { error: 'Failed to load last search data' },
      { status: 500 }
    )
  }
}
