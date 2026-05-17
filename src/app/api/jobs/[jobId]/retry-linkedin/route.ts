import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs, outreachTargets } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    // Load job details
    const [job] = await db
      .select({ company: jobs.company, title: jobs.title, archetype: jobs.archetype, archetypeConfidence: jobs.archetypeConfidence })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    // Reset outreach_target to pending so the connector re-runs from scratch
    await db
      .update(outreachTargets)
      .set({ status: 'pending', name: null, linkedinUrl: null, enrichmentJson: null,
             noteA: null, noteB: null, selectedNote: null, editedNote: null, errorMessage: null })
      .where(and(eq(outreachTargets.jobId, jobId), eq(outreachTargets.candidateId, candidateId)))

    // Queue a new linkedin_connector pipeline job
    const [pj] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'linkedin_connector',
        candidateId,
        payload: {
          job_id:               jobId,
          candidate_id:         candidateId,
          company:              job.company ?? '',
          job_title:            job.title,
          archetype:            job.archetype ?? '',
          archetype_confidence: Number(job.archetypeConfidence ?? 0),
        },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({ pipelineJobId: pj.id, status: 'queued' })
  } catch (e) {
    console.error('[retry-linkedin] error:', e)
    return NextResponse.json({ error: 'Failed to retry LinkedIn outreach' }, { status: 500 })
  }
}
