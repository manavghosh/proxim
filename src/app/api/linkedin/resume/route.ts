import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Preferences } from '@/types/candidate'

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const candidateId = searchParams.get('candidateId')
  if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

  const [row] = await db
    .select({ preferences: candidates.preferences })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

  const { linkedin_paused: _removed, ...rest } = (row.preferences ?? {}) as Preferences
  await db.update(candidates)
    .set({ preferences: { ...rest, linkedin_paused: false } as Preferences })
    .where(eq(candidates.id, candidateId))

  return NextResponse.json({ paused: false, message: 'LinkedIn outreach resumed.' })
}
