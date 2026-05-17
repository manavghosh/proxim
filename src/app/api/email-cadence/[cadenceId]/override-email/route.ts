import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, pipelineJobs } from '@/db/schema'

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

    const { confirmedEmail } = await request.json()

    const existing = await db
      .select()
      .from(emailCadences)
      .where(eq(emailCadences.id, cadenceId))

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const cadence = existing[0]

    if (cadence.status !== 'low_confidence') {
      return NextResponse.json(
        { error: "Cadence must be in 'low_confidence' status to override email" },
        { status: 422 }
      )
    }

    const [updated] = await db
      .update(emailCadences)
      .set({
        hiringManagerEmail: confirmedEmail,
        emailSource: 'manual_override',
        status: 'generating',
        updatedAt: new Date(),
      })
      .where(eq(emailCadences.id, cadenceId))
      .returning()

    await db.insert(pipelineJobs).values({
      jobType: 'outreach_mailer_generate',
      candidateId,
      payload: { cadence_id: cadenceId, job_id: cadence.jobId, candidate_id: candidateId },
    })

    return NextResponse.json({
      cadenceId,
      status: 'generating',
      hiringManagerEmail: confirmedEmail,
      emailSource: 'manual_override',
    })
  } catch (e) {
    console.error('[/api/email-cadence/override-email] POST error:', e)
    return NextResponse.json({ error: 'Failed to override email' }, { status: 500 })
  }
}
