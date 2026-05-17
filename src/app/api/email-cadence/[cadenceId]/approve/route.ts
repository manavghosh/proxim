import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts } from '@/db/schema'

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

    const existing = await db
      .select()
      .from(emailCadences)
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.candidateId, candidateId)))

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const cadence = existing[0]

    if (cadence.status === 'approved' || cadence.status === 'active') {
      return NextResponse.json(
        { error: 'Cadence has already been approved', currentStatus: cadence.status },
        { status: 409 }
      )
    }

    if (cadence.status !== 'pending_approval') {
      return NextResponse.json(
        { error: "Cadence must be in 'pending_approval' status to approve" },
        { status: 422 }
      )
    }

    const now = new Date()

    const [updated] = await db
      .update(emailCadences)
      .set({ status: 'approved', approvedAt: now })
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.status, 'pending_approval')))
      .returning({ id: emailCadences.id, status: emailCadences.status, approvedAt: emailCadences.approvedAt })

    if (!updated) {
      return NextResponse.json({ error: 'Cadence has already been approved', currentStatus: 'approved' }, { status: 409 })
    }

    // Schedule Day 1 immediately; Day 3 and Day 7 approved (scheduled by daemon after Day 1 sends)
    await db
      .update(emailDrafts)
      .set({ isApproved: true, status: 'scheduled', scheduledSendAt: now })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), eq(emailDrafts.dayNumber, 1)))

    await db
      .update(emailDrafts)
      .set({ isApproved: true, status: 'approved' })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), eq(emailDrafts.dayNumber, 3)))

    await db
      .update(emailDrafts)
      .set({ isApproved: true, status: 'approved' })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), eq(emailDrafts.dayNumber, 7)))

    return NextResponse.json({
      cadenceId,
      status: 'approved',
      approvedAt: now.toISOString(),
    })
  } catch (e) {
    console.error('[/api/email-cadence/approve] POST error:', e)
    return NextResponse.json({ error: 'Failed to approve cadence' }, { status: 500 })
  }
}
