import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { db } from '@/db'
import { resumeVersions } from '@/db/schema'

// Serves the most recent completed resume or cover-letter PDF for a job.
// Supports ?type=resume|cover-letter and ?download=true|false.
// Default is inline display (for iframe preview); add ?download=true to force
// browser download.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') ?? 'resume'
    const forceDownload = searchParams.get('download') === 'true'

    const [version] = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.jobId, jobId))
      .orderBy(desc(resumeVersions.createdAt))
      .limit(1)

    if (!version) {
      return NextResponse.json({ error: 'No resume version found' }, { status: 404 })
    }

    const relPath = type === 'cover-letter'
      ? version.coverLetterPdfPath
      : version.resumePdfPath

    if (!relPath) {
      return NextResponse.json({ error: 'PDF path not stored' }, { status: 404 })
    }

    // The Python agent stores paths relative to its working directory (agent/).
    // On local dev that means: <project-root>/agent/<relPath>.
    // Try the stored path as-is first, then prefix with agent/ for local dev.
    const candidates = [
      relPath,
      path.join('agent', relPath),
      path.join(process.cwd(), 'agent', relPath),
      path.join(process.cwd(), relPath),
    ]

    const filePath = candidates.find(existsSync)
    if (!filePath) {
      return NextResponse.json({ error: 'PDF file not found on disk' }, { status: 404 })
    }

    const fileBytes = await readFile(filePath)
    const filename = type === 'cover-letter' ? 'cover_letter.pdf' : 'resume.pdf'
    const disposition = forceDownload
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`

    return new NextResponse(fileBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
      },
    })
  } catch (e) {
    console.error('[resume/latest-pdf] error:', e)
    return NextResponse.json({ error: 'Failed to serve PDF' }, { status: 500 })
  }
}
