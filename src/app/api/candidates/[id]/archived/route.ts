import { NextResponse } from 'next/server'
import { listArchivedJobs } from '@/lib/archive-service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params
    const rows = await listArchivedJobs(candidateId)
    const jobs = rows.map((r) => ({
      id: r.id,
      title: r.title,
      company: r.company,
      location: r.location,
      sourceUrl: r.sourceUrl,
      status: r.status,
      grade: r.grade,
      postedAt: r.postedAt ? String(r.postedAt) : null,
      archivedAt: r.archivedAt ? String(r.archivedAt) : null,
      createdAt: r.createdAt ? String(r.createdAt) : null,
    }))
    return NextResponse.json({ jobs, total: jobs.length })
  } catch (e) {
    console.error('[/api/candidates/[id]/archived] GET error:', e)
    return NextResponse.json({ error: 'Failed to load archived jobs' }, { status: 500 })
  }
}
