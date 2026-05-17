import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { db } from '@/db'
import { resumeVersions } from '@/db/schema'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string; versionId: string }> }
) {
  try {
    const { versionId } = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') ?? 'resume'

    const [version] = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.id, versionId))
      .limit(1)

    if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

    const filePath = (type === 'cover-letter'
      ? version.coverLetterPdfPath
      : version.resumePdfPath) ?? ''

    if (!filePath) {
      return NextResponse.json({ error: 'PDF path not stored' }, { status: 404 })
    }

    // Try the stored path as-is, then prefix with agent/ for local dev.
    const candidates = [
      filePath,
      path.join('agent', filePath),
      path.join(process.cwd(), 'agent', filePath),
      path.join(process.cwd(), filePath),
    ]
    const resolvedPath = candidates.find(existsSync)
    if (!resolvedPath) {
      return NextResponse.json({ error: 'PDF not found on disk' }, { status: 404 })
    }

    const fileBytes = await readFile(resolvedPath)
    const filename = type === 'cover-letter' ? 'cover_letter.pdf' : 'resume.pdf'

    return new NextResponse(fileBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    console.error('[resume/download] error:', e)
    return NextResponse.json({ error: 'Failed to download PDF' }, { status: 500 })
  }
}
