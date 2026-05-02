import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'
import { getOrCreateCandidate } from '@/lib/cv-service'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gradeFilter = searchParams.get('grade') ?? 'all'

  try {
    const candidate = await getOrCreateCandidate()

    const allJobs = await db
      .select({
        id:                  jobs.id,
        title:               jobs.title,
        company:             jobs.company,
        location:            jobs.location,
        source:              jobs.source,
        sourceUrl:           jobs.sourceUrl,
        postedAt:            jobs.postedAt,
        status:              jobs.status,
        grade:               jobs.grade,
        score10d:            jobs.score10d,
        archetype:           jobs.archetype,
        archetypeConfidence: jobs.archetypeConfidence,
        createdAt:           jobs.createdAt,
      })
      .from(jobs)
      .where(eq(jobs.candidateId, candidate.id))
      .orderBy(jobs.createdAt)

    // Filter in application layer for SQLite + PG compatibility
    const EXCLUDED_STATUSES = new Set(['discovered', 'score_failed'])
    const filtered = allJobs.filter((j) => {
      if (!j.grade || j.grade === 'F') return false
      if (EXCLUDED_STATUSES.has(j.status)) return false
      if (gradeFilter === 'A') return j.grade === 'A'
      if (gradeFilter === 'A+B') return j.grade === 'A' || j.grade === 'B'
      return true
    })

    return NextResponse.json({ jobs: filtered })
  } catch (e) {
    console.error('[/api/jobs] error:', e)
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
  }
}
