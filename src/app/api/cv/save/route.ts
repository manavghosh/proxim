import { NextResponse } from 'next/server'
import { saveCVMarkdown, markParseReady, markParseFailed, getOrCreateCandidate } from '@/lib/cv-service'
import { parseCV } from '@/lib/cv-parser'

export async function POST(request: Request) {
  const body = await request.json() as { markdown?: string }

  if (typeof body.markdown !== 'string' || !body.markdown.trim()) {
    return NextResponse.json({ error: 'markdown is required' }, { status: 400 })
  }

  const { candidate, hashChanged } = await saveCVMarkdown(body.markdown)

  if (!hashChanged) {
    return NextResponse.json(candidate)
  }

  const candidateId = candidate.id
  const markdown = body.markdown

  try {
    const profile = await parseCV(markdown)
    await markParseReady(candidateId, profile)
  } catch (e) {
    console.error('[cv/save] parseCV failed:', e)
    try {
      await markParseFailed(candidateId)
    } catch (dbError) {
      console.error('[cv/save] markParseFailed failed:', dbError)
    }
  }

  const updated = await getOrCreateCandidate()
  return NextResponse.json(updated)
}
