import { NextResponse } from 'next/server'
import { archiveJob } from '@/lib/archive-service'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const candidateId = new URL(request.url).searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }

    const result = await archiveJob(jobId, candidateId)
    if (!result) {
      return NextResponse.json({ error: 'Job not found or already archived' }, { status: 404 })
    }

    return NextResponse.json({ jobId, archived: true })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/archive] POST error:', e)
    return NextResponse.json({ error: 'Failed to archive job' }, { status: 500 })
  }
}
