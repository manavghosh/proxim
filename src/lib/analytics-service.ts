import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AnalyticsMetrics, GradeDistribution, PipelineRunSummary, TimeRange } from '@/types/candidate'
import { jobs, emailDrafts, emailCadences, outreachTargets, pipelineRuns } from '@/db/schema'

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export function computeRatePercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 100)
}

export function countInProgress(runs: Array<{ status: string }>): number {
  return runs.filter(r => r.status === 'running' || r.status === 'queued').length
}

export function aggregateRunTotals(runs: Array<{
  jobsDiscovered: number
  abGradeCount: number
  emailsSent: number
  repliesReceived: number
  resumesGenerated: number
}>) {
  return runs.reduce(
    (acc, r) => ({
      totalJobsDiscovered:  acc.totalJobsDiscovered  + r.jobsDiscovered,
      totalAbGradeCount:    acc.totalAbGradeCount    + r.abGradeCount,
      totalEmailsSent:      acc.totalEmailsSent       + r.emailsSent,
      totalRepliesReceived: acc.totalRepliesReceived  + r.repliesReceived,
      totalResumesGenerated: acc.totalResumesGenerated + r.resumesGenerated,
    }),
    { totalJobsDiscovered: 0, totalAbGradeCount: 0, totalEmailsSent: 0, totalRepliesReceived: 0, totalResumesGenerated: 0 }
  )
}

export function buildZeroMetrics(): AnalyticsMetrics {
  return {
    totalJobsDiscovered:   0,
    abGradeRate:           null,
    emailOpenRate:         null,
    emailReplyRate:        null,
    linkedInAcceptRate:    null,
    interviewCallbackRate: null,
    gradeDistribution:     { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
    totalRuns:             0,
    inProgressRuns:        0,
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function getRangeStart(range: TimeRange): string | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

// ── DB-dependent computations ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

export async function computeGradeDistribution(
  candidateId: string,
  runIds: string[],
  db: DB
): Promise<GradeDistribution> {
  const dist: GradeDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 }
  if (runIds.length === 0) return dist

  const rows = await db
    .select({ grade: jobs.grade })
    .from(jobs)
    .where(
      and(
        eq(jobs.candidateId, candidateId),
        inArray(jobs.pipelineRunId, runIds),
        isNotNull(jobs.grade)
      )
    )

  for (const row of rows) {
    const g = row.grade as keyof GradeDistribution | null
    if (g && g in dist) dist[g]++
  }
  return dist
}

export async function computeMetrics(
  candidateId: string,
  completedRuns: Array<{
    id: string
    status: string
    jobsDiscovered: number
    abGradeCount: number
    emailsSent: number
    repliesReceived: number
    resumesGenerated: number
  }>,
  allRuns: Array<{ status: string }>,
  db: DB
): Promise<AnalyticsMetrics> {
  const inProgressRuns = countInProgress(allRuns)
  const totalRuns = completedRuns.length

  if (totalRuns === 0) {
    return { ...buildZeroMetrics(), inProgressRuns }
  }

  const totals = aggregateRunTotals(completedRuns)
  const runIds = completedRuns.map(r => r.id)

  // Grade distribution
  const gradeDistribution = await computeGradeDistribution(candidateId, runIds, db)

  const n = (rows: Array<{ count: number | string }>): number =>
    rows.length > 0 ? Number(rows[0].count) : 0

  // Email open rate: count email_drafts with openDetectedAt set / total sent drafts
  const [openResult, sentResult] = await Promise.all([
    db
      .select({ count: count() })
      .from(emailDrafts)
      .innerJoin(emailCadences, eq(emailDrafts.cadenceId, emailCadences.id))
      .innerJoin(jobs, eq(emailCadences.jobId, jobs.id))
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          inArray(jobs.pipelineRunId, runIds),
          isNotNull(emailDrafts.openDetectedAt)
        )
      ),
    db
      .select({ count: count() })
      .from(emailDrafts)
      .innerJoin(emailCadences, eq(emailDrafts.cadenceId, emailCadences.id))
      .innerJoin(jobs, eq(emailCadences.jobId, jobs.id))
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          inArray(jobs.pipelineRunId, runIds),
          eq(emailDrafts.status, 'sent')
        )
      ),
  ])

  // LinkedIn acceptance rate: invitations sent vs accepted
  const [liAccepted, liSent] = await Promise.all([
    db
      .select({ count: count() })
      .from(outreachTargets)
      .innerJoin(jobs, eq(outreachTargets.jobId, jobs.id))
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          inArray(jobs.pipelineRunId, runIds),
          isNotNull(outreachTargets.acceptedAt)
        )
      ),
    db
      .select({ count: count() })
      .from(outreachTargets)
      .innerJoin(jobs, eq(outreachTargets.jobId, jobs.id))
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          inArray(jobs.pipelineRunId, runIds),
          isNotNull(outreachTargets.sentAt)
        )
      ),
  ])

  // Interview callback rate: jobs with interviewCallbackAt / approved jobs
  const [interviewCount, approvedCount] = await Promise.all([
    db
      .select({ count: count() })
      .from(jobs)
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          inArray(jobs.pipelineRunId, runIds),
          isNotNull(jobs.interviewCallbackAt)
        )
      ),
    db
      .select({ count: count() })
      .from(jobs)
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          inArray(jobs.pipelineRunId, runIds),
          inArray(jobs.status, ['approved', 'resume_ready', 'submitted', 'resume_failed'])
        )
      ),
  ])

  return {
    totalJobsDiscovered:   totals.totalJobsDiscovered,
    abGradeRate:           computeRatePercent(totals.totalAbGradeCount, totals.totalJobsDiscovered),
    emailOpenRate:         computeRatePercent(n(openResult), n(sentResult)),
    emailReplyRate:        computeRatePercent(totals.totalRepliesReceived, totals.totalEmailsSent),
    linkedInAcceptRate:    computeRatePercent(n(liAccepted), n(liSent)),
    interviewCallbackRate: computeRatePercent(n(interviewCount), n(approvedCount)),
    gradeDistribution,
    totalRuns,
    inProgressRuns,
  }
}

// ── Route-level helpers ───────────────────────────────────────────────────────

export async function fetchRunsForRange(
  candidateId: string,
  range: TimeRange,
  db: DB
) {
  const rangeStart = getRangeStart(range)
  const conditions = [eq(pipelineRuns.candidateId, candidateId)]
  if (rangeStart) {
    // Use raw sql comparison: ISO strings sort correctly in SQLite (TEXT),
    // and PostgreSQL implicitly casts the string to timestamptz.
    conditions.push(sql`${pipelineRuns.startedAt} >= ${rangeStart}`)
  }
  return db.select().from(pipelineRuns).where(and(...conditions))
}

export function toPipelineRunSummary(row: {
  id: string
  status: string
  startedAt: Date | string | null
  completedAt: Date | string | null
  jobsDiscovered: number
  abGradeCount: number
  resumesGenerated: number
  emailsSent: number
  repliesReceived: number
}): PipelineRunSummary {
  const toIso = (v: Date | string | null): string | null =>
    v ? (v instanceof Date ? v.toISOString() : v) : null

  const startedAt = toIso(row.startedAt) ?? ''
  const completedAt = toIso(row.completedAt)

  const startMs = row.startedAt ? new Date(row.startedAt).getTime() : null
  const endMs   = row.completedAt ? new Date(row.completedAt).getTime() : null
  const durationSeconds = startMs !== null && endMs !== null
    ? Math.round((endMs - startMs) / 1000)
    : null

  return {
    id:               row.id,
    status:           row.status,
    startedAt,
    completedAt,
    durationSeconds,
    jobsDiscovered:   row.jobsDiscovered   ?? 0,
    abGradeCount:     row.abGradeCount     ?? 0,
    resumesGenerated: row.resumesGenerated ?? 0,
    emailsSent:       row.emailsSent       ?? 0,
    repliesReceived:  row.repliesReceived  ?? 0,
  }
}
