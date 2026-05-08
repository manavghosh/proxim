import { NextResponse } from 'next/server'
import { getOrCreateCandidate, getCandidateById, canReparse, markParseReady, markParseFailed } from '@/lib/cv-service'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import { parseCV } from '@/lib/cv-parser'

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const candidateIdParam = searchParams.get('candidateId')
    const candidate = candidateIdParam
      ? await getCandidateById(candidateIdParam)
      : await getOrCreateCandidate()
    if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    if (!canReparse(candidate)) {
      return NextResponse.json(
        { error: candidate.parseStatus === 'parsing' ? 'Parse already in progress' : 'No CV to parse' },
        { status: 400 }
      )
    }

    await db
      .update(candidates)
      .set({ parseStatus: 'parsing', parsedProfile: null })
      .where(eq(candidates.id, candidate.id))

    const id = candidate.id
    const markdown = candidate.baseCvMd!

    try {
      const profile = await parseCV(markdown)
      await markParseReady(id, profile)
    } catch (e) {
      console.error('[cv/reparse] parseCV failed:', e)
      try { await markParseFailed(id) } catch (dbError) {
        console.error('[cv/reparse] markParseFailed failed:', dbError)
      }
    }

    const updated = candidateIdParam
      ? await getCandidateById(candidateIdParam)
      : await getOrCreateCandidate()
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[cv/reparse] unexpected error:', e)
    return NextResponse.json({ error: 'Failed to trigger re-parse' }, { status: 500 })
  }
}
