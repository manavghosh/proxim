import { NextResponse, after } from 'next/server'
import { saveCVMarkdown, markParseReady, markParseFailed } from '@/lib/cv-service'
import { parseCV } from '@/lib/cv-parser'

export async function POST(request: Request) {
  const body = await request.json() as { markdown?: string }

  if (typeof body.markdown !== 'string' || !body.markdown.trim()) {
    return NextResponse.json({ error: 'markdown is required' }, { status: 400 })
  }

  const { candidate, hashChanged } = await saveCVMarkdown(body.markdown)

  if (hashChanged) {
    const candidateId = candidate.id
    const markdown = body.markdown

    after(async () => {
      try {
        const profile = await parseCV(markdown)
        await markParseReady(candidateId, profile)
      } catch {
        try {
          await markParseFailed(candidateId)
        } catch (dbError) {
          console.error('[cv/save] markParseFailed failed', { candidateId, dbError })
        }
      }
    })
  }

  return NextResponse.json(candidate)
}
