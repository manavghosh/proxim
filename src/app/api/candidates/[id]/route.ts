import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as { name?: string; avatarData?: string | null }

    const updates: { name?: string; avatarData?: string | null } = {}

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      updates.name = name
    }

    if (body.avatarData !== undefined) {
      updates.avatarData = body.avatarData
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const [updated] = await db
      .update(candidates)
      .set(updates)
      .where(eq(candidates.id, id))
      .returning({ id: candidates.id, name: candidates.name, avatarData: candidates.avatarData })

    if (!updated) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[/api/candidates/[id]] PATCH error:', e)
    return NextResponse.json({ error: 'Failed to update candidate' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db.delete(candidates).where(eq(candidates.id, id))
    return NextResponse.json({ deleted: true })
  } catch (e) {
    console.error('[/api/candidates/[id]] DELETE error:', e)
    return NextResponse.json({ error: 'Failed to delete candidate' }, { status: 500 })
  }
}
