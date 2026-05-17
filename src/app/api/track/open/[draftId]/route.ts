import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { emailDrafts } from '@/db/schema'

// 1×1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const { draftId } = await params

  try {
    const drafts = await db
      .select()
      .from(emailDrafts)
      .where(eq(emailDrafts.id, draftId))

    if (drafts.length > 0 && !drafts[0].openDetectedAt) {
      await db
        .update(emailDrafts)
        .set({ openDetectedAt: new Date() })
        .where(eq(emailDrafts.id, draftId))
    }
  } catch {
    // Silent fail — never reveal tracking pixel existence
  }

  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  })
}
