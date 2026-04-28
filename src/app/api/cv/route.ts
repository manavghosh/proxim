import { NextResponse } from 'next/server'
import { getOrCreateCandidate } from '@/lib/cv-service'

export async function GET() {
  try {
    const candidate = await getOrCreateCandidate()
    return NextResponse.json(candidate)
  } catch {
    return NextResponse.json({ error: 'Failed to load CV' }, { status: 500 })
  }
}
