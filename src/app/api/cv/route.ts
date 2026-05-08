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
    return NextResponse.json(candidate, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load CV' }, { status: 500 })
  }
}
