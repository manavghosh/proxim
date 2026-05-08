import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'
import { getOrCreateCandidate, getCandidateById } from '@/lib/cv-service'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')

    const candidate = candidateId ? await getCandidateById(candidateId) : await getOrCreateCandidate()
    const cId = candidate?.id

    const rows = await db
      .select({ status: jobs.status, count: sql<string>`count(*)` })
      .from(jobs)
      .where(cId ? eq(jobs.candidateId, cId) : undefined)
      .groupBy(jobs.status)

    const counts: Record<string, number> = {}
    for (const row of rows) {
      counts[row.status] = Number(row.count)
    }

    const scoreFailed  = counts['score_failed'] ?? 0
    const jobsMatched  = Object.entries(counts)
      .filter(([s]) => !['discovered', 'score_failed'].includes(s))
      .reduce((sum, [, n]) => sum + n, 0)
    const applications = (counts['approved'] ?? 0) + (counts['submitted'] ?? 0)

    return NextResponse.json({ scoreFailed, jobsMatched, applications })
  } catch (e) {
    console.error('[jobs/stats] error:', e)
    return NextResponse.json({ scoreFailed: 0, jobsMatched: 0, applications: 0 })
  }
}
