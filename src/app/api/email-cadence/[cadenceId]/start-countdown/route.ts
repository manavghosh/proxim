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
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [cadence] = await db.select().from(emailCadences)
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.candidateId, candidateId)))
    if (!cadence) return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    if (cadence.status !== 'approved')
      return NextResponse.json({ error: "Cadence must be in 'approved' status" }, { status: 422 })

    const now = new Date()
    const day3Due = new Date(now.getTime() + 72 * 60 * 60 * 1000)
    const day7Due = new Date(now.getTime() + 168 * 60 * 60 * 1000)

    await db.update(emailDrafts)
      .set({ status: 'approved', scheduledSendAt: day3Due })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), eq(emailDrafts.dayNumber, 3)))

    await db.update(emailDrafts)
      .set({ status: 'approved', scheduledSendAt: day7Due })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), eq(emailDrafts.dayNumber, 7)))

    await db.update(emailCadences)
      .set({ status: 'active', updatedAt: now })
      .where(eq(emailCadences.id, cadenceId))

    return NextResponse.json({
      cadenceId,
      status: 'active',
      day3Due: day3Due.toISOString(),
      day7Due: day7Due.toISOString(),
    })
  } catch (e) {
    console.error('[start-countdown] error:', e)
    return NextResponse.json({ error: 'Failed to start countdown' }, { status: 500 })
  }
}
