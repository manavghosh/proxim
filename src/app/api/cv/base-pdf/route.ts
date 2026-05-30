import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { db } from '@/db'
import { candidates } from '@/db/schema'

// Serves the candidate's own uploaded base resume PDF.
// Used by the email outreach panel's "View Resume" button when
// email_resume_attachment = 'original'.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
    }

    const [cand] = await db
      .select({ baseResumePdfPath: candidates.baseResumePdfPath })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1)

    if (!cand) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const relPath = cand.baseResumePdfPath
    if (!relPath) {
      return NextResponse.json({ error: 'No original resume uploaded' }, { status: 404 })
    }

    const lookups = [relPath, path.join(process.cwd(), relPath)]
    const filePath = lookups.find(existsSync)
    if (!filePath) {
      return NextResponse.json({ error: 'Resume file not found on disk' }, { status: 404 })
    }

    const forceDownload = searchParams.get('download') === 'true'
    const fileBytes = await readFile(filePath)

    // Serve under the candidate's original filename so they recognise it.
    const downloadName = path.basename(filePath).replace(/"/g, '')

    return new NextResponse(fileBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${forceDownload ? 'attachment' : 'inline'}; filename="${downloadName}"`,
      },
    })
  } catch (e) {
    console.error('[cv/base-pdf] error:', e)
    return NextResponse.json({ error: 'Failed to serve PDF' }, { status: 500 })
  }
}
