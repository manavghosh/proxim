import { NextResponse } from 'next/server'
import { getOrCreateCandidate } from '@/lib/cv-service'

export async function GET() {
  const candidate = await getOrCreateCandidate()
  return NextResponse.json(candidate)
}
