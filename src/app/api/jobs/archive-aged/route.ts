import { NextResponse } from 'next/server'
import { archiveAgedJobs, isValidArchiveAge } from '@/lib/archive-service'

export async function POST(request: Request) {
  try {
    const candidateId = new URL(request.url).searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const days = Number(body?.days)
    if (!isValidArchiveAge(days)) {
      return NextResponse.json({ error: 'days must be one of 30, 60, 90' }, { status: 400 })
    }
    const dryRun = body?.dryRun === true

    const { count } = await archiveAgedJobs(candidateId, days, { dryRun })
    return NextResponse.json({ count, days, dryRun })
  } catch (e) {
    console.error('[/api/jobs/archive-aged] POST error:', e)
    return NextResponse.json({ error: 'Failed to archive aged jobs' }, { status: 500 })
  }
}
