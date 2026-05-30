import { NextResponse } from 'next/server'
import { getOrCreateCandidate, getCandidateById } from '@/lib/cv-service'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    const candidate = candidateId
      ? await getCandidateById(candidateId)
      : await getOrCreateCandidate()
    if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    // No caching: the candidate row (CV, parse status, preferences) is mutated by
    // uploads/saves and polled for live parse status — stale cache causes the UI
    // to lag behind real state.
    return NextResponse.json(candidate, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load CV' }, { status: 500 })
  }
}
