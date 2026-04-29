import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { getOrCreateCandidate, canReparse, markParseReady, markParseFailed } from '@/lib/cv-service'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import { parseCV } from '@/lib/cv-parser'

export async function POST() {
  try {
    const candidate = await getOrCreateCandidate()

    if (!canReparse(candidate)) {
      return NextResponse.json(
        { error: candidate?.parseStatus === 'parsing' ? 'Parse already in progress' : 'No CV to parse' },
        { status: 400 }
      )
    }

    const [updated] = await db
      .update(candidates)
      .set({ parseStatus: 'parsing', parsedProfile: null })
      .where(eq(candidates.id, candidate.id))
      .returning()

    const candidateId = candidate.id
    const markdown = candidate.baseCvMd!

    after(async () => {
      try {
        const profile = await parseCV(markdown)
        await markParseReady(candidateId, profile)
      } catch {
        await markParseFailed(candidateId)
      }
    })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Failed to trigger re-parse' }, { status: 500 })
  }
}
