import { NextResponse } from 'next/server'
import { getReadiness } from '@/lib/readiness-service'

export async function GET() {
  const readiness = await getReadiness()
  return NextResponse.json(readiness)
}
