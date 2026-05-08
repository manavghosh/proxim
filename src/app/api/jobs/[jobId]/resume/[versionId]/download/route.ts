import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
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

    const filePath = type === 'cover-letter'
      ? version.coverLetterPdfPath
      : version.resumePdfPath

    if (!filePath || !existsSync(filePath)) {
      return NextResponse.json({ error: 'PDF not yet generated' }, { status: 404 })
    }

    const fileBytes = await readFile(filePath)
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
