import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  try {
    const [job] = await db
      .select({ reportMd: jobs.reportMd, grade: jobs.grade })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ reportMd: job.reportMd, grade: job.grade })
  } catch (e) {
    console.error('[/api/jobs/report] error:', e)
    return NextResponse.json({ error: 'Failed to load report' }, { status: 500 })
  }
}
