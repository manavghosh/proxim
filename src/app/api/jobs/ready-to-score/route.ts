import { NextResponse } from 'next/server'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'
import { getOrCreateCandidate, getCandidateById } from '@/lib/cv-service'
import { groupByPosition } from '@/lib/position-normalizer'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const candidateIdParam = searchParams.get('candidateId')

    const candidate = candidateIdParam
      ? await getCandidateById(candidateIdParam)
      : await getOrCreateCandidate()
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const rows = await db
      .select({ id: jobs.id, title: jobs.title, company: jobs.company })
      .from(jobs)
      .where(
        and(
          eq(jobs.candidateId, candidate.id),
          eq(jobs.status, 'discovered'),
          isNotNull(jobs.jdRaw),
          ne(jobs.jdRaw, ''),
        ),
      )

    return NextResponse.json(groupByPosition(rows))
  } catch (e) {
    console.error('[jobs/ready-to-score] error:', e)
    return NextResponse.json({ error: 'Failed to load ready-to-score jobs' }, { status: 500 })
  }
}
