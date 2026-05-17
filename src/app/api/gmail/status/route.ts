import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Preferences } from '@/types/candidate'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const candidateId = searchParams.get('candidateId')
  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
  }

  const [row] = await db
    .select({ preferences: candidates.preferences })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1)

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
  }

  const prefs     = (row.preferences ?? {}) as Preferences
  const token     = prefs.gmail_access_token
  const expiry    = prefs.gmail_token_expiry
  const isExpired = expiry ? new Date(expiry) < new Date() : false

  return NextResponse.json({
    connected: !!token && !isExpired,
    expired:   !!token && isExpired,
    email:     prefs.gmail_email ?? null,
    expiry:    expiry ?? null,
  })
}
