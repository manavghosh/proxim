import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { emailDrafts } from '@/db/schema'

const IMMUTABLE_STATUSES = ['sent', 'sending', 'cancelled', 'bounced']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string; draftId: string }> }
) {
  try {
    const { cadenceId, draftId } = await params
    const { bodyHtml } = await request.json()

    const existing = await db
      .select()
      .from(emailDrafts)
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.cadenceId, cadenceId)))

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Draft not found or does not belong to this cadence' }, { status: 404 })
    }

    const draft = existing[0]

    if (IMMUTABLE_STATUSES.includes(draft.status)) {
      return NextResponse.json(
        { error: 'Cannot edit a draft that has already been sent', currentStatus: draft.status },
        { status: 409 }
      )
    }

    const [updated] = await db
      .update(emailDrafts)
      .set({ bodyHtml, updatedAt: new Date() })
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.cadenceId, cadenceId)))
      .returning()

    return NextResponse.json({
      draftId: updated.id,
      dayNumber: updated.dayNumber,
      bodyHtml: updated.bodyHtml,
      originalBodyHtml: draft.originalBodyHtml,
      status: updated.status,
    })
  } catch (e) {
    console.error('[/api/email-cadence/drafts/[draftId]] PATCH error:', e)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }
}
