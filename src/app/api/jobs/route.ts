import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'
import { getOrCreateCandidate, getCandidateById } from '@/lib/cv-service'

const ALL_GRADES = ['A', 'B', 'C', 'D', 'F'] as const
const EXCLUDED_STATUSES = new Set(['discovered', 'score_failed'])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gradesParam = searchParams.get('grades')
  const selectedGrades = gradesParam
    ? new Set(gradesParam.split(',').filter((g) => ALL_GRADES.includes(g as typeof ALL_GRADES[number])))
    : new Set(ALL_GRADES)

  try {
    const candidateId = searchParams.get('candidateId')
    const candidate = candidateId ? await getCandidateById(candidateId) : await getOrCreateCandidate()
    if (!candidate) return NextResponse.json({ jobs: [] })

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

    const filtered = allJobs.filter((j) => {
      if (!j.grade) return false
      if (EXCLUDED_STATUSES.has(j.status)) return false
      return selectedGrades.has(j.grade)
    })

    return NextResponse.json({ jobs: filtered })
  } catch (e) {
    console.error('[/api/jobs] error:', e)
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
  }
}
