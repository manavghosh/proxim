import { NextResponse } from 'next/server'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs } from '@/db/schema'
import { getOrCreateCandidate } from '@/lib/cv-service'

const VALID_JOB_TYPES = ['full_pipeline', 'discovery_only', 'fetch_jds', 'score_jobs'] as const

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { jobType } = body as Record<string, unknown>

  if (!jobType || !VALID_JOB_TYPES.includes(jobType as typeof VALID_JOB_TYPES[number])) {
    return NextResponse.json(
      { error: `jobType must be one of: ${VALID_JOB_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  try {
    const candidate = await getOrCreateCandidate()

    // Auto-expire jobs stuck in running/queued for > 30 minutes (daemon was killed).
    // Use ISO string so it binds correctly for both SQLite (text) and PG (timestamp).
    const expiry = new Date(Date.now() - 30 * 60 * 1000).toISOString() as unknown as Date
    await db
      .update(pipelineJobs)
      .set({ status: 'failed', error: 'Expired — daemon did not complete this job' })
      .where(
        and(
          or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running')),
          or(isNull(pipelineJobs.startedAt), lt(pipelineJobs.startedAt, expiry)),
        ),
      )

    // Check for a genuinely active job (started < 30 min ago)
    const existing = await db
      .select({ id: pipelineJobs.id })
      .from(pipelineJobs)
      .where(
        or(
          eq(pipelineJobs.status, 'queued'),
          eq(pipelineJobs.status, 'running')
        )
      )
      .limit(1)

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A pipeline job is already queued or running' },
        { status: 409 }
      )
    }

    const [job] = await db
      .insert(pipelineJobs)
      .values({
        jobType: jobType as string,
        candidateId: candidate.id,
        payload: {},
      })
      .returning({ id: pipelineJobs.id, createdAt: pipelineJobs.createdAt })

    return NextResponse.json(
      { jobId: job.id, status: 'queued', createdAt: job.createdAt },
      { status: 201 }
    )
  } catch (e) {
    console.error('[pipeline/trigger] error:', e)
    return NextResponse.json({ error: 'Failed to enqueue pipeline job' }, { status: 500 })
  }
}
