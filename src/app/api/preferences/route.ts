import { NextResponse } from 'next/server'
import { getPreferences, updatePreferences } from '@/lib/preferences-service'

export async function GET() {
  const preferences = await getPreferences()
  return NextResponse.json({ preferences })
}

export async function PUT(request: Request) {
  const updates = await request.json() as Record<string, unknown>
  const preferences = await updatePreferences(updates)
  return NextResponse.json({ preferences })
}
