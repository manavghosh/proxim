import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts } from '@/db/schema'
import type { EmailCadenceStatus, EmailDraftStatus, EmailDraftSummary } from '@/types/candidate'

export async function GET(
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

    const cadences = await db
      .select()
      .from(emailCadences)
      .where(eq(emailCadences.id, cadenceId))

    if (cadences.length === 0) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const cadence = cadences[0]

    if (cadence.candidateId !== candidateId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const drafts = await db
      .select()
      .from(emailDrafts)
      .where(eq(emailDrafts.cadenceId, cadenceId))
      .orderBy(emailDrafts.dayNumber)

    const draftSummaries: EmailDraftSummary[] = drafts.map(d => ({
      id: d.id,
      dayNumber: d.dayNumber as 1 | 3 | 7,
      subject: d.subject,
      bodyHtml: d.bodyHtml,
      originalBodyHtml: d.originalBodyHtml,
      isApproved: d.isApproved,
      status: d.status as EmailDraftStatus,
      scheduledSendAt: d.scheduledSendAt ? String(d.scheduledSendAt) : null,
      sentAt: d.sentAt ? String(d.sentAt) : null,
      openDetectedAt: d.openDetectedAt ? String(d.openDetectedAt) : null,
      clickDetectedAt: d.clickDetectedAt ? String(d.clickDetectedAt) : null,
    }))

    return NextResponse.json({
      id: cadence.id,
      jobId: cadence.jobId,
      status: cadence.status as EmailCadenceStatus,
      hiringManagerEmail: cadence.hiringManagerEmail,
      emailConfidence: cadence.emailConfidence,
      approvedAt: cadence.approvedAt ? String(cadence.approvedAt) : null,
      replyDetectedAt: cadence.replyDetectedAt ? String(cadence.replyDetectedAt) : null,
      bounceDetectedAt: cadence.bounceDetectedAt ? String(cadence.bounceDetectedAt) : null,
      drafts: draftSummaries,
    })
  } catch (e) {
    console.error('[/api/email-cadence/[cadenceId]] GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch cadence' }, { status: 500 })
  }
}
