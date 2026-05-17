import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { emailDrafts } from '@/db/schema'

const ALREADY_SENT = ['sent', 'manually_sent']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string }> }
) {
  try {
    const { cadenceId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const { draftId } = await request.json()
    if (!draftId) return NextResponse.json({ error: 'draftId required' }, { status: 400 })

    const [draft] = await db.select().from(emailDrafts)
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.cadenceId, cadenceId)))
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (ALREADY_SENT.includes(draft.status))
      return NextResponse.json({ error: 'Draft already sent', currentStatus: draft.status }, { status: 409 })

    const now = new Date()
    const [updated] = await db.update(emailDrafts)
      .set({ status: 'manually_sent', sentAt: now, updatedAt: now })
      .where(eq(emailDrafts.id, draftId))
      .returning()

    return NextResponse.json({
      draftId: updated.id,
      dayNumber: updated.dayNumber,
      status: 'manually_sent',
      sentAt: now.toISOString(),
    })
  } catch (e) {
    console.error('[mark-sent] error:', e)
    return NextResponse.json({ error: 'Failed to mark draft as sent' }, { status: 500 })
  }
}
