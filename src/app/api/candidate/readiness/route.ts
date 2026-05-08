import { NextResponse } from 'next/server'
import { getReadiness } from '@/lib/readiness-service'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId') ?? undefined
    const readiness = await getReadiness(candidateId)
    return NextResponse.json(readiness, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load readiness' }, { status: 500 })
  }
}
