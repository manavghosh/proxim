import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params

    // Only resume_ready jobs can be marked as submitted — that's the natural
    // transition the user records after they download the PDF and apply.
    const updated = await db
      .update(jobs)
      .set({ status: 'submitted' })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'resume_ready')))
      .returning({ id: jobs.id, status: jobs.status })

    if (updated.length === 0) {
      const current = await db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)

      const currentStatus = current[0]?.status
      if (currentStatus === 'submitted') {
        return NextResponse.json(
          { error: 'Job already marked submitted', currentStatus },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: "Job must be in 'resume_ready' status before marking submitted", currentStatus },
        { status: 422 },
      )
    }

    return NextResponse.json({ jobId, status: 'submitted' })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/mark-submitted] POST error:', e)
    return NextResponse.json({ error: 'Failed to mark job as submitted' }, { status: 500 })
  }
}
