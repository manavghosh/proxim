import { and, eq, gte, inArray, desc } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineRuns } from '@/db/schema'
import type { TimeRange } from '@/types/candidate'
import { getRangeStart } from '@/lib/analytics-service'

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: candidateId } = await params
  const { searchParams } = new URL(request.url)
  const range = (searchParams.get('range') ?? 'all') as TimeRange

  const rangeStart = getRangeStart(range)
  const conditions = [
    eq(pipelineRuns.candidateId, candidateId),
    inArray(pipelineRuns.status, ['completed', 'failed']),
  ]
  if (rangeStart) {
    conditions.push(gte(pipelineRuns.startedAt, rangeStart))
  }

  const runs = await db
    .select()
    .from(pipelineRuns)
    .where(and(...conditions))
    .orderBy(desc(pipelineRuns.startedAt))

  const HEADER = 'run_id,started_at,completed_at,duration_minutes,jobs_discovered,ab_grade_count,resumes_generated,emails_sent,replies_received,status\n'

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(HEADER))
      for (const run of runs) {
        const durationMinutes = run.startedAt && run.completedAt
          ? Math.floor((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 60_000)
          : ''
        const row = [
          escapeCsvField(run.id),
          escapeCsvField(run.startedAt ? new Date(run.startedAt).toISOString() : ''),
          escapeCsvField(run.completedAt ? new Date(run.completedAt).toISOString() : ''),
          escapeCsvField(durationMinutes),
          escapeCsvField(run.jobsDiscovered),
          escapeCsvField(run.abGradeCount),
          escapeCsvField(run.resumesGenerated),
          escapeCsvField(run.emailsSent),
          escapeCsvField(run.repliesReceived),
          escapeCsvField(run.status),
        ].join(',') + '\n'
        controller.enqueue(encoder.encode(row))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="pipeline-history.csv"',
      'Cache-Control': 'no-cache',
    },
  })
}
