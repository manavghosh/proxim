import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs, emailCadences } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [job] = await db
      .select({ company: jobs.company, title: jobs.title, archetype: jobs.archetype, archetypeConfidence: jobs.archetypeConfidence })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    // Check no cadence already exists in an active state
    const [existing] = await db.select({ id: emailCadences.id, status: emailCadences.status })
      .from(emailCadences)
      .where(eq(emailCadences.jobId, jobId))
      .limit(1)

    const RESTARTABLE = ['failed', 'cancelled', 'email_not_found', 'pending_discovery', 'discovering', 'generating']
    if (existing && !RESTARTABLE.includes(existing.status)) {
      return NextResponse.json(
        { error: 'Email outreach already running', currentStatus: existing.status },
        { status: 409 }
      )
    }

    // Queue outreach_mailer — daemon will create the cadence + run full flow
    const [pj] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'outreach_mailer',
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
    console.error('[start-email-outreach] error:', e)
    return NextResponse.json({ error: 'Failed to start email outreach' }, { status: 500 })
  }
}
