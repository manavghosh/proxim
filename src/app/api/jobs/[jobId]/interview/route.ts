import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
    }

    const body = await request.json() as { mark?: boolean }
    const mark = body.mark !== false

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
      .limit(1)

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const interviewCallbackAt = mark ? new Date() : null

    await db
      .update(jobs)
      .set({ interviewCallbackAt })
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))

    return NextResponse.json({
      jobId,
      interviewCallbackAt: interviewCallbackAt ? interviewCallbackAt.toISOString() : null,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to update interview callback' }, { status: 500 })
  }
}
