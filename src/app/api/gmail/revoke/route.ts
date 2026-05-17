import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Preferences } from '@/types/candidate'

export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
    }

    const [candidate] = await db
      .select({ preferences: candidates.preferences })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1)

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const prefs = (candidate.preferences ?? {}) as Preferences
    const refreshToken = prefs.gmail_refresh_token

    // Revoke at Google — best-effort, do not block on failure
    if (refreshToken) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        )
      } catch {
        // Revocation failure is non-fatal — we still clear locally
      }
    }

    // Clear all 4 Gmail fields + reset mode to manual
    const cleaned: Preferences = {
      ...prefs,
      gmail_access_token:  undefined,
      gmail_refresh_token: undefined,
      gmail_email:         undefined,
      gmail_token_expiry:  undefined,
      email_outreach_mode: 'manual',
    }

    // Remove undefined keys so they're actually deleted from the JSONB
    const cleanedJson = Object.fromEntries(
      Object.entries(cleaned).filter(([, v]) => v !== undefined)
    )

    await db
      .update(candidates)
      .set({ preferences: cleanedJson })
      .where(eq(candidates.id, candidateId))

    return NextResponse.json({ revoked: true, mode: 'manual' })
  } catch (e) {
    console.error('[/api/gmail/revoke] error:', e)
    return NextResponse.json({ error: 'Failed to revoke Gmail access' }, { status: 500 })
  }
}
