import { NextResponse } from 'next/server'
import { and, eq, gte, count } from 'drizzle-orm'
import { db } from '@/db'
import { candidates, outreachTargets } from '@/db/schema'
import type { Preferences } from '@/types/candidate'

const DAILY_LIMIT = 20
const LI_INVITATIONS = 'https://api.linkedin.com/v2/invitations'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ targetId: string }> }
) {
  try {
    const { targetId } = await params
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    let body: { selectedNote?: 'A' | 'B'; editedNote?: string; manual?: boolean }
    try { body = await request.json() } catch { body = {} }
    const { selectedNote, editedNote, manual } = body
    if (!selectedNote) return NextResponse.json({ error: 'selectedNote required' }, { status: 400 })

    // 1. Load candidate prefs — check paused + get access token
    const [cand] = await db
      .select({ preferences: candidates.preferences })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1)
    if (!cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    const prefs = (cand.preferences ?? {}) as Preferences
    if (prefs.linkedin_paused) {
      return NextResponse.json({ error: 'LinkedIn outreach is paused' }, { status: 403 })
    }

    // 2. Load outreach target
    const [target] = await db
      .select({
        id: outreachTargets.id, candidateId: outreachTargets.candidateId,
        status: outreachTargets.status, noteA: outreachTargets.noteA,
        noteB: outreachTargets.noteB, sentAt: outreachTargets.sentAt,
        linkedinUrl: outreachTargets.linkedinUrl,
      })
      .from(outreachTargets)
      .where(and(eq(outreachTargets.id, targetId), eq(outreachTargets.candidateId, candidateId)))
      .limit(1)

    if (!target) return NextResponse.json({ error: 'Outreach target not found' }, { status: 404 })
    if (target.status === 'sent' || target.status === 'accepted') {
      return NextResponse.json({ error: 'Already sent', currentStatus: target.status }, { status: 409 })
    }
    if (target.status !== 'notes_ready') {
      return NextResponse.json({ error: `Target not in notes_ready status (current: ${target.status})` }, { status: 422 })
    }

    // 3. Count today's sends
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
    const todayStartStr = todayStart.toISOString() as unknown as Date
    const [{ count: dailyCount }] = await db
      .select({ count: count() })
      .from(outreachTargets)
      .where(
        and(
          eq(outreachTargets.candidateId, candidateId),
          eq(outreachTargets.status, 'sent'),
          gte(outreachTargets.sentAt, todayStartStr)
        )
      )

    const resolvedNote = editedNote || (selectedNote === 'A' ? target.noteA : target.noteB) || ''

    // 4. Queue if over limit
    if (Number(dailyCount) >= DAILY_LIMIT) {
      await db.update(outreachTargets)
        .set({ status: 'queued', selectedNote, editedNote: editedNote ?? null })
        .where(eq(outreachTargets.id, targetId))
      return NextResponse.json({ status: 'queued', message: 'Daily limit reached. Sends tomorrow.' })
    }

    // 5a. Manual send — user confirmed they sent it themselves on LinkedIn.
    if (manual === true) {
      const sentAt = new Date()
      const sentAtStr = sentAt.toISOString() as unknown as Date
      await db.update(outreachTargets)
        .set({ status: 'sent', selectedNote, editedNote: editedNote ?? null, sentAt: sentAtStr })
        .where(eq(outreachTargets.id, targetId))
      return NextResponse.json({ targetId, status: 'sent', sentAt: sentAt.toISOString(), manual: true })
    }

    // 5b. Call LinkedIn Invitations API.
    //    Extract the vanity name from the URL:
    //      https://linkedin.com/in/caiosabenca          → caiosabenca
    //      https://linkedin.com/in/caiosabenca/         → caiosabenca
    //      https://linkedin.com/in/caiosabenca?foo=bar  → caiosabenca
    const rawUrl = target.linkedinUrl ?? ''
    const profileId = new URL(rawUrl.startsWith('http') ? rawUrl : `https://linkedin.com${rawUrl}`)
      .pathname.replace(/\/$/, '').split('/').pop() ?? ''
    if (!profileId) {
      return NextResponse.json({ error: 'No LinkedIn profile URL on this target' }, { status: 422 })
    }

    const accessToken = prefs.linkedin_access_token ?? ''
    const liRes = await fetch(LI_INVITATIONS, {
      method:  'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202501',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        invitee: {
          'com.linkedin.voyager.growth.invitation.InviteeProfile': {
            profileId,
          },
        },
        message: resolvedNote,
      }),
    })

    if (liRes.status === 429) {
      // Rate limited — pause all outreach
      await db.update(outreachTargets).set({ status: 'paused' }).where(eq(outreachTargets.id, targetId))
      await db.update(candidates)
        .set({ preferences: { ...prefs, linkedin_paused: true } as Preferences })
        .where(eq(candidates.id, candidateId))
      return NextResponse.json({ status: 'paused', error: 'LinkedIn rate limit reached' }, { status: 200 })
    }

    if (!liRes.ok) {
      const liBody = await liRes.text()
      console.error('[select-and-send] LinkedIn error', liRes.status, profileId, liBody)
      return NextResponse.json({ error: 'LinkedIn API error', liStatus: liRes.status, liBody: liBody.slice(0, 500) }, { status: 502 })
    }

    const liData = await liRes.json()
    const invitationId = String(liData.id ?? '')
    const sentAt = new Date()
    const sentAtStr = sentAt.toISOString() as unknown as Date

    // 6. Mark sent
    await db.update(outreachTargets)
      .set({ status: 'sent', selectedNote, editedNote: editedNote ?? null,
             sentAt: sentAtStr, linkedinInvitationId: invitationId })
      .where(eq(outreachTargets.id, targetId))

    return NextResponse.json({ targetId, status: 'sent', sentAt: sentAt.toISOString() })
  } catch (e) {
    console.error('[outreach/select-and-send] POST error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
