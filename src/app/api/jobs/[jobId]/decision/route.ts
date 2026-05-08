import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

const VALID_DECISIONS = ['approved', 'rejected', 'snoozed', 'scored'] as const
type Decision = typeof VALID_DECISIONS[number]

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { decision } = body as Record<string, unknown>
  if (!decision || !VALID_DECISIONS.includes(decision as Decision)) {
    return NextResponse.json(
      { error: `decision must be one of: ${VALID_DECISIONS.join(', ')}` },
      { status: 400 }
    )
  }

  try {
    await db
      .update(jobs)
      .set({ status: decision as Decision })
      .where(eq(jobs.id, jobId))

    return NextResponse.json({ jobId, status: decision })
  } catch (e) {
    console.error('[/api/jobs/decision] error:', e)
    return NextResponse.json({ error: 'Failed to update decision' }, { status: 500 })
  }
}
