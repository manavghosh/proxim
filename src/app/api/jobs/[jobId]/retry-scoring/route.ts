import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs } from '@/db/schema'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const url = new URL(_request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [job] = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    if (job.status !== 'score_failed') {
      return NextResponse.json(
        { error: `Job must be in score_failed status to retry (current: ${job.status})` },
        { status: 422 }
      )
    }

    // Reset the job so the scoring graph picks it up
    await db
      .update(jobs)
      .set({ status: 'discovered', errorMessage: null })
      .where(eq(jobs.id, jobId))

    // Queue a score_jobs run scoped to this single job
    const [pj] = await db
      .insert(pipelineJobs)
      .values({
        jobType:     'score_jobs',
        candidateId,
        payload:     { job_ids: [jobId], candidate_id: candidateId },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({ pipelineJobId: pj.id, status: 'queued' })
  } catch (e) {
    console.error('[retry-scoring] error:', e)
    return NextResponse.json({ error: 'Failed to retry scoring' }, { status: 500 })
  }
}
