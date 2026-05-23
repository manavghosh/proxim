import { NextResponse } from 'next/server'
import { and, eq, inArray, gte, desc } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineRuns } from '@/db/schema'
import type { TimeRange } from '@/types/candidate'
import { getRangeStart, toPipelineRunSummary } from '@/lib/analytics-service'

const PAGE_SIZE = 50

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params
    const { searchParams } = new URL(request.url)
    const range = (searchParams.get('range') ?? 'all') as TimeRange
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))

    const rangeStart = getRangeStart(range)
    const conditions = [eq(pipelineRuns.candidateId, candidateId)]
    if (rangeStart) {
      conditions.push(gte(pipelineRuns.startedAt, rangeStart))
    }

    const allRuns = await db
      .select()
      .from(pipelineRuns)
      .where(and(...conditions))
      .orderBy(desc(pipelineRuns.startedAt))

    const inProgressRuns = allRuns
      .filter(r => r.status === 'running' || r.status === 'queued')
      .map(toPipelineRunSummary)

    const terminalRuns = allRuns.filter(r => r.status === 'completed' || r.status === 'failed')
    const total = terminalRuns.length
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const offset = (page - 1) * PAGE_SIZE
    const pageRuns = terminalRuns.slice(offset, offset + PAGE_SIZE).map(toPipelineRunSummary)

    return NextResponse.json({
      runs: pageRuns,
      total,
      page,
      totalPages,
      inProgress: inProgressRuns,
    })
  } catch (e) {
    console.error('[/api/candidates/[id]/analytics/runs] GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch run history' }, { status: 500 })
  }
}
