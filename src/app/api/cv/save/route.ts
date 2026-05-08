import { NextResponse } from 'next/server'
import { saveCVMarkdown, markParseReady, markParseFailed, getCandidateById, getOrCreateCandidate } from '@/lib/cv-service'
import { parseCV } from '@/lib/cv-parser'

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const candidateId = searchParams.get('candidateId')

  const body = await request.json() as { markdown?: string }

  if (typeof body.markdown !== 'string' || !body.markdown.trim()) {
    return NextResponse.json({ error: 'markdown is required' }, { status: 400 })
  }

  const { candidate, hashChanged } = await saveCVMarkdown(body.markdown, candidateId ?? undefined)

  if (!hashChanged) return NextResponse.json(candidate)

  const id = candidate.id
  const markdown = body.markdown

  try {
    const profile = await parseCV(markdown)
    await markParseReady(id, profile)
  } catch (e) {
    console.error('[cv/save] parseCV failed:', e)
    try { await markParseFailed(id) } catch {}
  }

  const updated = candidateId
    ? await getCandidateById(candidateId)
    : await getOrCreateCandidate()
  return NextResponse.json(updated)
}
