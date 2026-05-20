import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts, pipelineJobs } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string }> }
) {
  try {
    const { cadenceId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }

    const { confirmedEmail } = await request.json() as { confirmedEmail?: string }
    if (!confirmedEmail || !confirmedEmail.includes('@')) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
    }

    const [cadence] = await db
      .select()
      .from(emailCadences)
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.candidateId, candidateId)))
      .limit(1)

    if (!cadence) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const OVERRIDABLE = ['low_confidence', 'email_not_found', 'failed']
    if (!OVERRIDABLE.includes(cadence.status)) {
      return NextResponse.json(
        { error: `Cannot override email in status '${cadence.status}'` },
        { status: 422 }
      )
    }

    // Check whether drafts were already generated (optimistic generation)
    const [existingDraft] = await db
      .select({ id: emailDrafts.id })
      .from(emailDrafts)
      .where(eq(emailDrafts.cadenceId, cadenceId))
      .limit(1)

    if (existingDraft) {
      // Drafts exist — go straight to pending_approval, no generation job needed
      await db
        .update(emailCadences)
        .set({
          hiringManagerEmail: confirmedEmail,
          emailSource:        'manual',
          status:             'pending_approval',
          updatedAt:          new Date(),
        })
        .where(eq(emailCadences.id, cadenceId))

      return NextResponse.json({
        cadenceId,
        status:             'pending_approval',
        hiringManagerEmail: confirmedEmail,
        emailSource:        'manual',
      })
    }

    // No drafts yet (cadence pre-dates optimistic generation) — trigger generation
    await db
      .update(emailCadences)
      .set({
        hiringManagerEmail: confirmedEmail,
        emailSource:        'manual',
        status:             'generating',
        updatedAt:          new Date(),
      })
      .where(eq(emailCadences.id, cadenceId))

    await db.insert(pipelineJobs).values({
      jobType:     'outreach_mailer_generate',
      candidateId,
      payload: {
        cadence_id:   cadenceId,
        job_id:       cadence.jobId,
        candidate_id: candidateId,
      },
    })

    return NextResponse.json({
      cadenceId,
      status:             'generating',
      hiringManagerEmail: confirmedEmail,
      emailSource:        'manual',
    })
  } catch (e) {
    console.error('[/api/email-cadence/override-email] POST error:', e)
    return NextResponse.json({ error: 'Failed to override email' }, { status: 500 })
  }
}
