import { NextResponse } from 'next/server'
import { db } from '@/db'
import { jobs, emailCadences, emailDrafts } from '@/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { aggregateInsights } from '@/lib/insights-helpers'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: candidateId } = await params

  const cadenceSubquery = db
    .select({ id: emailCadences.id })
    .from(emailCadences)
    .where(eq(emailCadences.candidateId, candidateId))

  const [allJobs, allCadences, allDrafts] = await Promise.all([
    db
      .select({
        id: jobs.id,
        status: jobs.status,
        archetype: jobs.archetype,
        archetypeConfidence: jobs.archetypeConfidence,
        interviewCallbackAt: jobs.interviewCallbackAt,
        grade: jobs.grade,
      })
      .from(jobs)
      .where(eq(jobs.candidateId, candidateId)),

    db
      .select({
        id: emailCadences.id,
        jobId: emailCadences.jobId,
        replyDetectedAt: emailCadences.replyDetectedAt,
        status: emailCadences.status,
      })
      .from(emailCadences)
      .where(eq(emailCadences.candidateId, candidateId)),

    db
      .select({
        id: emailDrafts.id,
        cadenceId: emailDrafts.cadenceId,
        dayNumber: emailDrafts.dayNumber,
        sentAt: emailDrafts.sentAt,
        openDetectedAt: emailDrafts.openDetectedAt,
      })
      .from(emailDrafts)
      .where(inArray(emailDrafts.cadenceId, cadenceSubquery)),
  ])

  const result = aggregateInsights(candidateId, {
    jobs: allJobs.map(j => ({
      ...j,
      archetypeConfidence: j.archetypeConfidence ? Number(j.archetypeConfidence) : null,
    })),
    cadences: allCadences,
    drafts: allDrafts,
  })

  return NextResponse.json(result)
}
