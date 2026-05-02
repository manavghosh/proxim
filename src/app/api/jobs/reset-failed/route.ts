import { NextResponse } from 'next/server'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs, pipelineLogs } from '@/db/schema'

export async function POST() {
  try {
    // 1. Find all score_failed jobs
    const failedJobs = await db
      .select({ id: jobs.id, title: jobs.title, company: jobs.company })
      .from(jobs)
      .where(eq(jobs.status, 'score_failed'))

    if (failedJobs.length === 0) {
      return NextResponse.json({ reset: 0 })
    }

    const failedIds = failedJobs.map((j) => j.id)

    // 2. For each failed job, find most recent warning log with matching job_id in data
    const errorReasons = new Map<string, string>()
    for (const job of failedJobs) {
      const [logEntry] = await db
        .select({ data: pipelineLogs.data })
        .from(pipelineLogs)
        .where(
          and(
            eq(pipelineLogs.level, 'warning'),
            sql`${pipelineLogs.data}->>'job_id' = ${job.id}`
          )
        )
        .orderBy(desc(pipelineLogs.createdAt))
        .limit(1)

      const reason = (logEntry?.data?.error as string | undefined)?.slice(0, 120) ?? 'unknown error'
      errorReasons.set(job.id, reason)
    }

    // 3. Reset all score_failed → discovered
    await db
      .update(jobs)
      .set({ status: 'discovered' })
      .where(inArray(jobs.id, failedIds))

    // 4. Find most recent score_jobs pipeline job to append logs to
    const [scoreJob] = await db
      .select({ id: pipelineJobs.id })
      .from(pipelineJobs)
      .where(eq(pipelineJobs.jobType, 'score_jobs'))
      .orderBy(desc(pipelineJobs.createdAt))
      .limit(1)

    if (scoreJob) {
      const perJobEntries = failedJobs.map((job) => ({
        pipelineJobId: scoreJob.id,
        level: 'info',
        step: 'reset_failed',
        message: `Reset: ${job.title} @ ${job.company} — ${errorReasons.get(job.id)}`,
        data: { job_id: job.id } as Record<string, unknown>,
      }))

      const summaryEntry = {
        pipelineJobId: scoreJob.id,
        level: 'info',
        step: 'reset_failed',
        message: `Reset ${failedJobs.length} failed jobs — ready to rescore`,
        data: { count: failedJobs.length } as Record<string, unknown>,
      }

      try {
        await db.insert(pipelineLogs).values([...perJobEntries, summaryEntry])
      } catch {
        // Log insert failure is non-fatal — reset still succeeded
      }
    }

    return NextResponse.json({ reset: failedJobs.length })
  } catch (e) {
    console.error('[jobs/reset-failed] error:', e)
    return NextResponse.json({ error: 'Failed to reset jobs' }, { status: 500 })
  }
}
