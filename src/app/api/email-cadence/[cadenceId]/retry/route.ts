import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts, pipelineJobs, jobs } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string }> }
) {
  try {
    const { cadenceId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [cadence] = await db
      .select()
      .from(emailCadences)
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.candidateId, candidateId)))
      .limit(1)

    if (!cadence) return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })

    if (cadence.status !== 'failed' && cadence.status !== 'email_not_found') {
      return NextResponse.json(
        { error: `Cadence must be in 'failed' or 'email_not_found' status to retry (current: ${cadence.status})` },
        { status: 422 }
      )
    }

    // Load job details for generation context
    const [job] = await db
      .select({ company: jobs.company, title: jobs.title, archetype: jobs.archetype })
      .from(jobs)
      .where(eq(jobs.id, cadence.jobId))
      .limit(1)

    // Delete any partial drafts from the failed run
    await db.delete(emailDrafts).where(eq(emailDrafts.cadenceId, cadenceId))

    // Reset cadence to generating (email address already known — skip discovery)
    await db
      .update(emailCadences)
      .set({ status: 'generating', errorMessage: null, updatedAt: new Date() })
      .where(eq(emailCadences.id, cadenceId))

    // Queue outreach_mailer_generate — skips Hunter.io, goes straight to LLM
    const [pj] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'outreach_mailer_generate',
        candidateId,
        payload: {
          cadence_id:   cadenceId,
          job_id:       cadence.jobId,
          candidate_id: candidateId,
          company:      job?.company ?? '',
          job_title:    job?.title ?? '',
          archetype:    job?.archetype ?? '',
        },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({
      cadenceId,
      pipelineJobId: pj.id,
      status: 'generating',
    })
  } catch (e) {
    console.error('[email-cadence/retry] error:', e)
    return NextResponse.json({ error: 'Failed to retry email generation' }, { status: 500 })
  }
}
