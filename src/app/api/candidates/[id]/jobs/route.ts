import { NextResponse } from 'next/server'
import { and, eq, ne, notInArray } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, hitlCheckpoints } from '@/db/schema'

type JobStatus = 'awaiting' | 'approved' | 'rejected' | 'snoozed' | 'discovered' | 'scored' | 'score_failed' | 'resume_failed' | 'resume_ready' | 'submitted'
const EXCLUDED_STATUSES: JobStatus[] = ['discovered', 'score_failed', 'rejected']

function computeNumericScore(score10d: Record<string, unknown> | null): number | null {
  if (!score10d) return null
  try {
    const weighted = score10d.weighted as Record<string, { score: number }> | undefined
    if (!weighted) return null
    const scores = Object.values(weighted).map(d => d.score)
    if (scores.length === 0) return null
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
  } catch {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params
    const url = new URL(request.url)
    const filter = url.searchParams.get('filter') ?? 'all'
    const sort = url.searchParams.get('sort') ?? 'score'

    const rows = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        location: jobs.location,
        source: jobs.source,
        sourceUrl: jobs.sourceUrl,
        postedAt: jobs.postedAt,
        status: jobs.status,
        grade: jobs.grade,
        score10d: jobs.score10d,
        reportMd: jobs.reportMd,
        archetype: jobs.archetype,
        archetypeConfidence: jobs.archetypeConfidence,
        createdAt: jobs.createdAt,
        hitlCheckpointId: hitlCheckpoints.id,
        hitlStatus: hitlCheckpoints.status,
        hitlSnoozedUntil: hitlCheckpoints.snoozedUntil,
        hitlCreatedAt: hitlCheckpoints.createdAt,
      })
      .from(jobs)
      .leftJoin(hitlCheckpoints, eq(hitlCheckpoints.jobId, jobs.id))
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          ne(jobs.grade, 'F'),
          notInArray(jobs.status, EXCLUDED_STATUSES)
        )
      )
      .orderBy(jobs.createdAt)

    // Always exclude F-grade as a safety net (DB WHERE also handles this)
    let filtered = rows.filter(r => r.grade !== 'F')

    // Apply grade filter
    if (filter === 'A') {
      filtered = filtered.filter(r => r.grade === 'A')
    } else if (filter === 'A+B') {
      filtered = filtered.filter(r => r.grade === 'A' || r.grade === 'B')
    }
    // 'all' includes A/B/C/D

    // Apply sort
    if (sort === 'score') {
      filtered = filtered.sort((a, b) => {
        const sa = computeNumericScore(a.score10d as Record<string, unknown> | null) ?? -1
        const sb = computeNumericScore(b.score10d as Record<string, unknown> | null) ?? -1
        return sb - sa
      })
    } else if (sort === 'date') {
      filtered = filtered.sort((a, b) => {
        const da = a.postedAt ? new Date(a.postedAt instanceof Date ? a.postedAt.toISOString() : String(a.postedAt)).getTime() : 0
        const db2 = b.postedAt ? new Date(b.postedAt instanceof Date ? b.postedAt.toISOString() : String(b.postedAt)).getTime() : 0
        return db2 - da
      })
    } else if (sort === 'company') {
      filtered = filtered.sort((a, b) => a.company.localeCompare(b.company))
    }

    const mapped = filtered.map(r => ({
      id: r.id,
      title: r.title,
      company: r.company,
      location: r.location,
      source: r.source,
      sourceUrl: r.sourceUrl,
      postedAt: r.postedAt,
      status: r.status,
      grade: r.grade,
      numericScore: computeNumericScore(r.score10d as Record<string, unknown> | null),
      score10d: r.score10d,
      reportMd: r.reportMd,
      archetype: r.archetype,
      archetypeConfidence: r.archetypeConfidence,
      hitlCheckpoint: r.hitlCheckpointId
        ? {
            id: r.hitlCheckpointId,
            status: r.hitlStatus,
            snoozedUntil: r.hitlSnoozedUntil,
            createdAt: r.hitlCreatedAt,
          }
        : null,
    }))

    return NextResponse.json({ jobs: mapped, total: mapped.length })
  } catch (e) {
    console.error('[/api/candidates/[id]/jobs] GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}
