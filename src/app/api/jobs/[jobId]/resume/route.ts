import { NextResponse } from 'next/server'
import { and, desc, eq, or } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs, candidates, resumeVersions } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')

    // Validate job exists and is approved
    const [job] = await db
      .select({ id: jobs.id, status: jobs.status, candidateId: jobs.candidateId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (job.status !== 'approved') {
      return NextResponse.json(
        { error: "Job must be in 'approved' status to generate resume" },
        { status: 422 }
      )
    }

    // Check for existing active resume_builder job
    const existing = await db
      .select({ id: pipelineJobs.id })
      .from(pipelineJobs)
      .where(
        and(
          eq(pipelineJobs.jobType, 'resume_builder'),
          or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running'))
        )
      )
      .limit(1)

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A resume_builder job is already queued or running', pipelineJobId: existing[0].id },
        { status: 409 }
      )
    }

    const cId = candidateId ?? job.candidateId
    const [inserted] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'resume_builder',
        candidateId: cId!,
        payload: { job_id: jobId, candidate_id: cId } as Record<string, unknown>,
      })
      .returning({ id: pipelineJobs.id, createdAt: pipelineJobs.createdAt })

    return NextResponse.json({ pipelineJobId: inserted.id, status: 'queued' }, { status: 201 })
  } catch (e) {
    console.error('[jobs/[jobId]/resume] POST error:', e)
    return NextResponse.json({ error: 'Failed to trigger resume generation' }, { status: 500 })
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params

    const [job] = await db
      .select({ candidateId: jobs.candidateId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    // Get current candidate cv_hash for staleness check
    const [cand] = job.candidateId
      ? await db.select({ cvHash: candidates.baseCvHash }).from(candidates).where(eq(candidates.id, job.candidateId)).limit(1)
      : [{ cvHash: null }]

    const versions = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.jobId, jobId))
      .orderBy(desc(resumeVersions.createdAt))

    const currentCvHash = cand?.cvHash ?? null
    const result = versions.map((v) => ({
      ...v,
      isStale: currentCvHash !== null && v.baseCvHash !== currentCvHash,
    }))

    return NextResponse.json({ versions: result, currentCvHash })
  } catch (e) {
    console.error('[jobs/[jobId]/resume] GET error:', e)
    return NextResponse.json({ error: 'Failed to load resume versions' }, { status: 500 })
  }
}
