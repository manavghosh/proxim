import { NextResponse } from 'next/server'
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

    const [parsing] = await db
      .update(candidates)
      .set({ parseStatus: 'parsing', parsedProfile: null })
      .where(eq(candidates.id, candidate.id))
      .returning()

    const candidateId = candidate.id
    const markdown = candidate.baseCvMd!

    try {
      const profile = await parseCV(markdown)
      await markParseReady(candidateId, profile)
    } catch (e) {
      console.error('[cv/reparse] parseCV failed:', e)
      try {
        await markParseFailed(candidateId)
      } catch (dbError) {
        console.error('[cv/reparse] markParseFailed failed:', dbError)
      }
    }

    const updated = await getOrCreateCandidate()
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[cv/reparse] unexpected error:', e)
    return NextResponse.json({ error: 'Failed to trigger re-parse' }, { status: 500 })
  }
}
