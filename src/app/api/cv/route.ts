import { NextResponse } from 'next/server'
import { getOrCreateCandidate } from '@/lib/cv-service'

export async function GET() {
  try {
    const candidate = await getOrCreateCandidate()
    return NextResponse.json(candidate, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load CV' }, { status: 500 })
  }
}
