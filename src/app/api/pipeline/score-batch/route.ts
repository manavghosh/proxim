import { NextResponse } from 'next/server'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs } from '@/db/schema'
import { getOrCreateCandidate, getCandidateById } from '@/lib/cv-service'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { jobIds } = (body ?? {}) as { jobIds?: unknown }
  if (!Array.isArray(jobIds) || jobIds.length === 0 || !jobIds.every((id) => typeof id === 'string')) {
    return NextResponse.json(
      { error: 'jobIds must be a non-empty array of strings' },
      { status: 400 },
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const candidateIdParam = searchParams.get('candidateId')
    const candidate = candidateIdParam
      ? await getCandidateById(candidateIdParam)
      : await getOrCreateCandidate()
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    // Auto-expire jobs stuck in running/queued for > 30 minutes (mirrors trigger route).
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

    // Dedup guard: only block if the *exact same batch* is already queued/running
    // (prevents double-click double-submission). A different selection must
    // always create a new job — never silently redirect to a "score all" job
    // or a previous batch with different job IDs.
    const existing = await db
      .select({ id: pipelineJobs.id, payload: pipelineJobs.payload })
      .from(pipelineJobs)
      .where(
        and(
          eq(pipelineJobs.jobType, 'score_jobs'),
          eq(pipelineJobs.candidateId, candidate.id),
          or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running')),
        ),
      )
      .limit(1)

    if (existing.length > 0) {
      const existingIds: string[] =
        (existing[0].payload as { job_ids?: string[] } | null)?.job_ids ?? []
      const sameBatch =
        existingIds.length === jobIds.length &&
        jobIds.every((id) => existingIds.includes(id))
      if (sameBatch) {
        return NextResponse.json({ jobId: existing[0].id, status: 'running' }, { status: 200 })
      }
      // Different selection — cancel any queued (not yet started) jobs for this
      // candidate so they don't run after the new batch and waste tokens.
      // Running jobs are left alone: interrupting mid-scoring leaves inconsistent state.
      await db
        .update(pipelineJobs)
        .set({ status: 'failed', error: 'Superseded by a new scoring batch' })
        .where(
          and(
            eq(pipelineJobs.jobType, 'score_jobs'),
            eq(pipelineJobs.candidateId, candidate.id),
            eq(pipelineJobs.status, 'queued'),
          ),
        )
    }

    const [job] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'score_jobs',
        candidateId: candidate.id,
        payload: { job_ids: jobIds },
      })
      .returning({ id: pipelineJobs.id, createdAt: pipelineJobs.createdAt })

    return NextResponse.json(
      { jobId: job.id, status: 'queued', createdAt: job.createdAt },
      { status: 201 },
    )
  } catch (e) {
    console.error('[pipeline/score-batch] error:', e)
    return NextResponse.json({ error: 'Failed to enqueue score batch' }, { status: 500 })
  }
}
