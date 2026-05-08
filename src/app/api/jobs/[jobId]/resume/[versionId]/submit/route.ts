import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { resumeVersions, jobs } from '@/db/schema'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; versionId: string }> }
) {
  try {
    const { jobId, versionId } = await params

    const [version] = await db
      .select({ id: resumeVersions.id, isSubmitted: resumeVersions.isSubmitted })
      .from(resumeVersions)
      .where(eq(resumeVersions.id, versionId))
      .limit(1)

    if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    if (version.isSubmitted) {
      return NextResponse.json({ error: 'Version is already marked as submitted' }, { status: 409 })
    }

    await db.update(resumeVersions).set({ isSubmitted: true }).where(eq(resumeVersions.id, versionId))
    await db.update(jobs).set({ status: 'submitted' }).where(eq(jobs.id, jobId))

    return NextResponse.json({ versionId, isSubmitted: true })
  } catch (e) {
    console.error('[resume/submit] error:', e)
    return NextResponse.json({ error: 'Failed to mark as submitted' }, { status: 500 })
  }
}
