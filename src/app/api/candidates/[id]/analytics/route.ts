import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineRuns } from '@/db/schema'
import type { TimeRange } from '@/types/candidate'
import { fetchRunsForRange, computeMetrics, buildZeroMetrics } from '@/lib/analytics-service'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: candidateId } = await params
    const { searchParams } = new URL(request.url)
    const range = (searchParams.get('range') ?? '30d') as TimeRange

    const allRuns = await fetchRunsForRange(candidateId, range, db)

    const completedRuns = allRuns.filter(
      (r: { status: string }) => r.status === 'completed'
    )

    if (completedRuns.length === 0) {
      const inProgressRuns = allRuns.filter((r: { status: string }) => r.status === 'running').length
      return NextResponse.json({
        metrics: { ...buildZeroMetrics(), inProgressRuns, totalRuns: 0 },
        range,
      })
    }

    const metrics = await computeMetrics(candidateId, completedRuns, allRuns, db)

    return NextResponse.json({ metrics, range })
  } catch (e) {
    console.error('[/api/candidates/[id]/analytics] GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
