import { NextResponse } from 'next/server'
import { unarchiveJob } from '@/lib/archive-service'

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

    const result = await unarchiveJob(jobId, candidateId)
    if (!result) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ jobId, archived: false, status: result.status })
  } catch (e) {
    console.error('[/api/jobs/[jobId]/unarchive] POST error:', e)
    return NextResponse.json({ error: 'Failed to restore job' }, { status: 500 })
  }
}
