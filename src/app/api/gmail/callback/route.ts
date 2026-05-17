import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Preferences } from '@/types/candidate'

function settingsUrl(request: Request, candidateId: string, status: string) {
  return new URL(`/candidates/${candidateId}/settings?gmail=${status}`, request.url).toString()
}

function decodeState(state: string): { candidateId: string } | null {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString())
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const error = searchParams.get('error')
  const code  = searchParams.get('code')
  const state = searchParams.get('state')

  // User denied or Google returned an error
  if (error) {
    const decoded = state ? decodeState(state) : null
    const target  = decoded
      ? settingsUrl(request, decoded.candidateId, 'error')
      : new URL('/?gmail=error', request.url).toString()
    return NextResponse.redirect(target)
  }

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  const decoded = decodeState(state)
  if (!decoded) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }
  const { candidateId } = decoded

  // Exchange auth code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  process.env.GMAIL_REDIRECT_URI!,
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
    }),
  })

  if (!tokenRes.ok) {
    console.error('[gmail/callback] token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(settingsUrl(request, candidateId, 'error'))
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json()

  if (!refresh_token) {
    // refresh_token only returned on first consent — prompt=consent in connect route ensures this
    console.error('[gmail/callback] no refresh_token returned')
    return NextResponse.redirect(settingsUrl(request, candidateId, 'error'))
  }

  // Fetch Gmail address to display in UI
  let gmailEmail = ''
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (profileRes.ok) {
      const p = await profileRes.json()
      gmailEmail = p.email ?? ''
    }
  } catch { /* non-fatal */ }

  // Load existing preferences — merge, never clobber
  const [row] = await db
    .select({ preferences: candidates.preferences })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1)

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
  }

  const existing   = (row.preferences ?? {}) as Preferences
  const expiresAt  = new Date(Date.now() + expires_in * 1000).toISOString()

  await db
    .update(candidates)
    .set({
      preferences: {
        ...existing,
        gmail_access_token:  access_token,
        gmail_refresh_token: refresh_token,
        gmail_email:         gmailEmail,
        gmail_token_expiry:  expiresAt,
      } as Preferences,
    })
    .where(eq(candidates.id, candidateId))

  return NextResponse.redirect(settingsUrl(request, candidateId, 'connected'))
}
