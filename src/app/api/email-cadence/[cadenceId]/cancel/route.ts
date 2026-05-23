import { NextResponse } from 'next/server'
import { eq, and, or } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts } from '@/db/schema'

const TERMINAL = ['replied', 'bounced', 'cancelled', 'cadence_complete', 'failed']

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
    if (TERMINAL.includes(cadence.status))
      return NextResponse.json({ error: 'Cadence already in terminal state', currentStatus: cadence.status }, { status: 409 })

    await db.update(emailDrafts)
      .set({ status: 'cancelled' })
      .where(and(
        eq(emailDrafts.cadenceId, cadenceId),
        or(eq(emailDrafts.status, 'draft'), eq(emailDrafts.status, 'approved'), eq(emailDrafts.status, 'scheduled'))
      ))

    await db.update(emailCadences)
      .set({ status: 'cancelled' })
      .where(eq(emailCadences.id, cadenceId))

    return NextResponse.json({ cadenceId, status: 'cancelled' })
  } catch (e) {
    console.error('[cancel] error:', e)
    return NextResponse.json({ error: 'Failed to cancel cadence' }, { status: 500 })
  }
}
