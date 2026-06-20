import { and, eq, inArray, desc } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

/**
 * Job archival service.
 *
 * Archiving is an organizational/visibility action, independent of a job's
 * lifecycle `status`. Archived jobs are hidden from the Scorecard and
 * Applications screens but retained in the DB and restorable from the Archived
 * screen. Restoring (unarchive) simply clears the flag, so the job reappears on
 * whichever screen its existing `status` already routes it to.
 */

/** Statuses that represent an active application pipeline — never auto-swept. */
export const ARCHIVE_PROTECTED_STATUSES = ['approved', 'resume_ready', 'submitted'] as const

/** Allowed "older than N days" choices for the bulk aged-archive sweep. */
export const ARCHIVE_AGE_OPTIONS = [30, 60, 90] as const
export type ArchiveAgeDays = (typeof ARCHIVE_AGE_OPTIONS)[number]

export function isValidArchiveAge(days: number): days is ArchiveAgeDays {
  return (ARCHIVE_AGE_OPTIONS as readonly number[]).includes(days)
}

/** The cutoff instant: jobs posted strictly before this are "older than N days". */
export function cutoffDate(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

type AgedCandidateJob = {
  status: string
  postedAt: Date | string | null
  interviewCallbackAt: Date | string | null
  archived: boolean
}

/**
 * Pure eligibility predicate for the bulk aged-archive sweep.
 *
 * A job is sweepable when it is NOT already archived, NOT in an active pipeline
 * (status not in {@link ARCHIVE_PROTECTED_STATUSES} and no interview callback),
 * and its posting date is known and older than the cutoff. Jobs with a NULL or
 * unparseable `postedAt` are skipped (they can still be archived individually).
 */
export function isAgedArchivable(job: AgedCandidateJob, days: number, now: Date): boolean {
  if (job.archived) return false
  if (job.interviewCallbackAt != null) return false
  if ((ARCHIVE_PROTECTED_STATUSES as readonly string[]).includes(job.status)) return false
  if (job.postedAt == null) return false
  const posted = job.postedAt instanceof Date ? job.postedAt : new Date(job.postedAt)
  if (Number.isNaN(posted.getTime())) return false
  return posted.getTime() < cutoffDate(now, days).getTime()
}

// Timestamps are written as ISO strings (not Date objects) so the same code
// works on both backends: better-sqlite3 cannot bind a Date to its `text`
// column, and Postgres's timestamp column accepts the ISO string fine. The
// `as never` cast bridges the PG-typed schema (Date) vs the runtime value.
// (Same pattern as src/lib/hitl-checkpoint.ts.)
function nowIso(): never {
  return new Date().toISOString() as never
}

/** Archive a single job (scoped by candidate). Returns the row, or null if no match. */
export async function archiveJob(jobId: string, candidateId: string) {
  const updated = await db
    .update(jobs)
    .set({ archived: true, archivedAt: nowIso() })
    .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId), eq(jobs.archived, false)))
    .returning({ id: jobs.id, archived: jobs.archived })
  return updated[0] ?? null
}

/** Restore a single archived job (scoped by candidate). Returns the row, or null. */
export async function unarchiveJob(jobId: string, candidateId: string) {
  const updated = await db
    .update(jobs)
    .set({ archived: false, archivedAt: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
    .returning({ id: jobs.id, status: jobs.status, archived: jobs.archived })
  return updated[0] ?? null
}

/**
 * Bulk-archive a candidate's "aged" inactive jobs (posting older than `days`).
 * Eligibility is decided in JS via {@link isAgedArchivable} (consistent with the
 * existing list endpoints' filtering) for clear, testable rules. When `dryRun`
 * is set, the count is returned without writing — used to populate the confirm
 * dialog. Returns `{ count }` of jobs matched (and, when not a dry run, archived).
 */
export async function archiveAgedJobs(
  candidateId: string,
  days: number,
  opts?: { dryRun?: boolean; now?: Date },
): Promise<{ count: number }> {
  const now = opts?.now ?? new Date()
  const rows = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      postedAt: jobs.postedAt,
      interviewCallbackAt: jobs.interviewCallbackAt,
      archived: jobs.archived,
    })
    .from(jobs)
    .where(eq(jobs.candidateId, candidateId))

  const ids = rows.filter((r) => isAgedArchivable(r, days, now)).map((r) => r.id)

  if (!opts?.dryRun && ids.length > 0) {
    await db
      .update(jobs)
      .set({ archived: true, archivedAt: now.toISOString() as never })
      .where(and(eq(jobs.candidateId, candidateId), inArray(jobs.id, ids)))
  }

  return { count: ids.length }
}

/** List a candidate's archived jobs (all statuses), newest-archived first. */
export async function listArchivedJobs(candidateId: string) {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      sourceUrl: jobs.sourceUrl,
      status: jobs.status,
      grade: jobs.grade,
      postedAt: jobs.postedAt,
      archivedAt: jobs.archivedAt,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(and(eq(jobs.candidateId, candidateId), eq(jobs.archived, true)))
    .orderBy(desc(jobs.archivedAt))
}
