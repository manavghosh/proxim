import { NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs } from '@/db/schema'

// Returns the most recent `resume_builder` pipeline_job for the given job_id,
// so the Applications page can poll its log stream and show an inline
// build-progress pane on each card.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params

    const [row] = await db
      .select({ id: pipelineJobs.id, status: pipelineJobs.status })
      .from(pipelineJobs)
      .where(
        sql`${pipelineJobs.jobType} = 'resume_builder' AND ${pipelineJobs.payload}->>'job_id' = ${jobId}`,
      )
      .orderBy(desc(pipelineJobs.createdAt))
      .limit(1)

    if (!row) {
      return NextResponse.json({ pipelineJobId: null, status: null })
    }
    return NextResponse.json({ pipelineJobId: row.id, status: row.status })
  } catch (e) {
    // SQLite stores the JSON payload as text, so the `->>` operator above
    // works on Neon but not on better-sqlite3. Fall back to a substring match.
    try {
      const { jobId } = await params
      const rows = await db
        .select({ id: pipelineJobs.id, status: pipelineJobs.status, payload: pipelineJobs.payload })
        .from(pipelineJobs)
        .where(eq(pipelineJobs.jobType, 'resume_builder'))
        .orderBy(desc(pipelineJobs.createdAt))
        .limit(50)
      const match = rows.find((r) => {
        const p = r.payload as Record<string, unknown> | string | null
        if (!p) return false
        const obj = typeof p === 'string' ? (JSON.parse(p) as Record<string, unknown>) : p
        return obj?.job_id === jobId
      })
      if (!match) return NextResponse.json({ pipelineJobId: null, status: null })
      return NextResponse.json({ pipelineJobId: match.id, status: match.status })
    } catch (inner) {
      console.error('[/api/jobs/[jobId]/resume/pipeline-job] error:', inner ?? e)
      return NextResponse.json({ error: 'Failed to look up resume pipeline job' }, { status: 500 })
    }
  }
}
