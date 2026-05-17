import { NextResponse } from 'next/server'
import { and, count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates, outreachTargets } from '@/db/schema'
import type { Preferences } from '@/types/candidate'

const DAILY_LIMIT = 20

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const candidateId = searchParams.get('candidateId')
  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
  }

  const rows = await db
    .select({ preferences: candidates.preferences })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1)

  if (!rows.length) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
  }

  const prefs     = (rows[0].preferences ?? {}) as Preferences
  const token     = prefs.linkedin_access_token
  const expiresAt = prefs.linkedin_token_expires_at
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false

  // Count today's sends and queued requests
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
  const [sentRow]   = await db
    .select({ count: count() })
    .from(outreachTargets)
    .where(and(eq(outreachTargets.candidateId, candidateId),
               eq(outreachTargets.status, 'sent')))
  const [queuedRow] = await db
    .select({ count: count() })
    .from(outreachTargets)
    .where(and(eq(outreachTargets.candidateId, candidateId),
               eq(outreachTargets.status, 'queued')))

  return NextResponse.json({
    connected:             !!token && !isExpired,
    expired:               isExpired,
    profileName:           prefs.linkedin_profile_name ?? null,
    connectedAt:           prefs.linkedin_connected_at ?? null,
    paused:                prefs.linkedin_paused ?? false,
    dailySendsToday:       Number(sentRow?.count ?? 0),
    dailyLimit:            DAILY_LIMIT,
    queuedCount:           Number(queuedRow?.count ?? 0),
    doNotContactCompanies: prefs.do_not_contact_companies ?? [],
  })
}
