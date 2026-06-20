import { NextResponse } from 'next/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { candidates, jobs } from '@/db/schema'

export async function GET() {
  try {
    const allCandidates = await db
      .select({
        id:          candidates.id,
        name:        candidates.name,
        parseStatus: candidates.parseStatus,
        createdAt:   candidates.createdAt,
        avatarData:  candidates.avatarData,
      })
      .from(candidates)
      .orderBy(desc(candidates.createdAt))

    const summaries = await Promise.all(allCandidates.map(async (c) => {
      const [matchedRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(jobs)
        .where(and(eq(jobs.candidateId, c.id), eq(jobs.archived, false)))

      const [approvedRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(jobs)
        .where(and(eq(jobs.candidateId, c.id), eq(jobs.archived, false)))

      return {
        ...c,
        jobsMatched:  Number(matchedRow?.count ?? 0),
        applications: Number(approvedRow?.count ?? 0),
      }
    }))

    return NextResponse.json({ candidates: summaries })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/candidates] GET error:', e)
    return NextResponse.json({ error: 'Failed to load candidates', detail: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string }
    const name = body.name?.trim() || 'New Candidate'
    const [created] = await db.insert(candidates).values({ name }).returning()
    return NextResponse.json({ id: created.id, name: created.name }, { status: 201 })
  } catch (e) {
    console.error('[/api/candidates] POST error:', e)
    return NextResponse.json({ error: 'Failed to create candidate' }, { status: 500 })
  }
}
