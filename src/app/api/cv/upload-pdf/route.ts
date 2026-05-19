import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const RESUME_DIR = process.env.RESUME_OUTPUT_DIR ?? path.join(process.cwd(), 'resumes')

function candidateSlug(name: string): string {
  return (name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unnamed'
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
    }

    const [cand] = await db
      .select({ name: candidates.name })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1)
    if (!cand) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File must be under 10 MB' }, { status: 400 })
    }

    const slug = candidateSlug(cand.name)
    const dir  = path.join(RESUME_DIR, slug)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, 'base_resume.pdf')

    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))

    await db
      .update(candidates)
      .set({ baseResumePdfPath: filePath })
      .where(eq(candidates.id, candidateId))

    return NextResponse.json({ path: filePath, filename: file.name })
  } catch (e) {
    console.error('[cv/upload-pdf] error:', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
