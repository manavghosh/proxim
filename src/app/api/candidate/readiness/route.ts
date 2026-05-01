import { NextResponse } from 'next/server'
import { getReadiness } from '@/lib/readiness-service'

export async function GET() {
  try {
    const readiness = await getReadiness()
    return NextResponse.json(readiness, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load readiness' }, { status: 500 })
  }
}
