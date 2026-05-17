import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Preferences } from '@/types/candidate'

function settingsUrl(request: Request, candidateId: string, status: string) {
  return new URL(`/candidates/${candidateId}/settings?linkedin=${status}`, request.url).toString()
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

  // User denied or LinkedIn returned an error
  if (error) {
    const decoded = state ? decodeState(state) : null
    const target  = decoded
      ? settingsUrl(request, decoded.candidateId, 'error')
      : new URL('/?linkedin=error', request.url).toString()
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

  // Exchange auth code for access token
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  process.env.LINKEDIN_REDIRECT_URI!,
      client_id:     process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  })

  if (!tokenRes.ok) {
    console.error('[linkedin/callback] token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(settingsUrl(request, candidateId, 'error'))
  }

  const { access_token, expires_in, refresh_token } = await tokenRes.json()

  // Fetch profile name — non-fatal
  let profileName = 'LinkedIn User'
  try {
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (profileRes.ok) {
      const p = await profileRes.json()
      profileName =
        p.name ??
        (`${p.given_name ?? ''} ${p.family_name ?? ''}`.trim() || profileName)
    }
  } catch { /* non-fatal */ }

  // Load existing preferences so we don't clobber them
  const rows = await db
    .select({ preferences: candidates.preferences })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1)

  if (!rows.length) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
  }

  const existing  = (rows[0].preferences ?? {}) as Preferences
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString()

  await db
    .update(candidates)
    .set({
      preferences: {
        ...existing,
        linkedin_access_token:    access_token,
        linkedin_refresh_token:   refresh_token ?? null,
        linkedin_token_expires_at: expiresAt,
        linkedin_connected_at:    new Date().toISOString(),
        linkedin_profile_name:    profileName,
      } as Preferences,
    })
    .where(eq(candidates.id, candidateId))

  return NextResponse.redirect(settingsUrl(request, candidateId, 'connected'))
}
