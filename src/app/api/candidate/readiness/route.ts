import { NextResponse } from 'next/server'
import { getReadiness } from '@/lib/readiness-service'

export async function GET() {
  try {
    const readiness = await getReadiness()
    return NextResponse.json(readiness)
  } catch {
    return NextResponse.json({ error: 'Failed to load readiness' }, { status: 500 })
  }
}
