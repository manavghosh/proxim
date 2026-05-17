import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { emailDrafts } from '@/db/schema'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const { draftId } = await params
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')

  if (!targetUrl) {
    return NextResponse.json({ error: 'url parameter is required' }, { status: 400 })
  }

  try {
    const drafts = await db
      .select()
      .from(emailDrafts)
      .where(eq(emailDrafts.id, draftId))

    if (drafts.length > 0 && !drafts[0].clickDetectedAt) {
      await db
        .update(emailDrafts)
        .set({ clickDetectedAt: new Date() })
        .where(eq(emailDrafts.id, draftId))
    }
  } catch {
    // Silent fail
  }

  return Response.redirect(decodeURIComponent(targetUrl), 301)
}
