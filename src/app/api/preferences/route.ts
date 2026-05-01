import { NextResponse } from 'next/server'
import { getPreferences, updatePreferences } from '@/lib/preferences-service'

export async function GET() {
  try {
    const preferences = await getPreferences()
    return NextResponse.json({ preferences }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  let updates: unknown
  try {
    updates = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }
  try {
    const preferences = await updatePreferences(updates as Record<string, unknown>)
    return NextResponse.json({ preferences })
  } catch {
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
  }
}
