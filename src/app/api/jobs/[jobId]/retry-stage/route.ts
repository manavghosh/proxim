import { NextResponse } from 'next/server'
import { and, eq, desc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs } from '@/db/schema'

type JobStatus = 'discovered' | 'scored' | 'awaiting' | 'approved' | 'rejected' | 'snoozed' | 'score_failed' | 'resume_failed' | 'resume_ready' | 'submitted'

const STAGE_RESET_STATUS: Record<string, JobStatus> = {
  resume_builder:     'approved',
  linkedin_connector: 'approved',
  outreach_mailer:    'approved',
  score_jobs:         'discovered',
}

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

    const [job] = await db
      .select({ id: jobs.id, candidateId: jobs.candidateId })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
      .limit(1)

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Check for an already-running pipeline job for this job
    const [runningJob] = await db
      .select({ id: pipelineJobs.id })
      .from(pipelineJobs)
      .where(
        and(
          eq(pipelineJobs.candidateId, candidateId),
          eq(pipelineJobs.status, 'running'),
          sql`${pipelineJobs.payload}->>'job_id' = ${jobId}`
        )
      )
      .limit(1)

    if (runningJob) {
      return NextResponse.json(
        { error: 'A pipeline job for this job is already running', activeJobId: runningJob.id },
        { status: 409 }
      )
    }

    // Find the most recent failed pipeline job for this job
    const [failedJob] = await db
      .select({ id: pipelineJobs.id, jobType: pipelineJobs.jobType })
      .from(pipelineJobs)
      .where(
        and(
          eq(pipelineJobs.candidateId, candidateId),
          eq(pipelineJobs.status, 'failed'),
          sql`${pipelineJobs.payload}->>'job_id' = ${jobId}`
        )
      )
      .orderBy(desc(pipelineJobs.createdAt))
      .limit(1)

    if (!failedJob) {
      return NextResponse.json({ error: 'No failed pipeline job found for this job' }, { status: 404 })
    }

    const resetJobStatus = STAGE_RESET_STATUS[failedJob.jobType] ?? 'approved'

    // Reset job status to allow the agent to pick it up again
    await db
      .update(jobs)
      .set({ status: resetJobStatus })
      .where(eq(jobs.id, jobId))

    // Enqueue a new pipeline job for the same stage
    const [newPipelineJob] = await db
      .insert(pipelineJobs)
      .values({
        candidateId,
        jobType: failedJob.jobType,
        status: 'queued',
        payload: { job_id: jobId },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({
      jobId,
      newPipelineJobId: newPipelineJob.id,
      jobType: failedJob.jobType,
      resetJobStatus,
    })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/retry-stage] POST error:', e)
    return NextResponse.json({ error: 'Failed to retry pipeline stage' }, { status: 500 })
  }
}
