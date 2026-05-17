import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, emailCadences, emailDrafts } from '@/db/schema'
import { getOrCreateCandidate, getCandidateById } from '@/lib/cv-service'
import type { EmailCadenceSummary, EmailCadenceStatus, EmailDraftStatus, EmailDraftSummary } from '@/types/candidate'

const ALL_GRADES = ['A', 'B', 'C', 'D', 'E', 'F'] as const
// Applications is post-decision tracking only: hide jobs that haven't been
// scored yet (discovered/score_failed) AND jobs still awaiting a decision
// (scored/awaiting). Those live on the Pipeline page.
const EXCLUDED_STATUSES = new Set(['discovered', 'score_failed', 'scored', 'awaiting'])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gradesParam = searchParams.get('grades')
  const selectedGrades = gradesParam
    ? new Set(gradesParam.split(',').filter((g) => ALL_GRADES.includes(g as typeof ALL_GRADES[number])))
    : new Set(ALL_GRADES)

  try {
    const candidateId = searchParams.get('candidateId')
    const candidate = candidateId ? await getCandidateById(candidateId) : await getOrCreateCandidate()
    if (!candidate) return NextResponse.json({ jobs: [] })

    const allJobs = await db
      .select({
        id:                  jobs.id,
        title:               jobs.title,
        company:             jobs.company,
        location:            jobs.location,
        source:              jobs.source,
        sourceUrl:           jobs.sourceUrl,
        postedAt:            jobs.postedAt,
        status:              jobs.status,
        grade:               jobs.grade,
        score10d:            jobs.score10d,
        archetype:           jobs.archetype,
        archetypeConfidence: jobs.archetypeConfidence,
        createdAt:           jobs.createdAt,
        cadenceId:              emailCadences.id,
        cadenceStatus:          emailCadences.status,
        cadenceHiringEmail:     emailCadences.hiringManagerEmail,
        cadenceEmailConfidence: emailCadences.emailConfidence,
        cadenceApprovedAt:      emailCadences.approvedAt,
        cadenceReplyAt:         emailCadences.replyDetectedAt,
        cadenceBounceAt:        emailCadences.bounceDetectedAt,
      })
      .from(jobs)
      .leftJoin(emailCadences, eq(emailCadences.jobId, jobs.id))
      .where(eq(jobs.candidateId, candidate.id))
      .orderBy(jobs.createdAt)

    const filtered = allJobs.filter((j) => {
      if (!j.grade) return false
      if (EXCLUDED_STATUSES.has(j.status)) return false
      return selectedGrades.has(j.grade)
    })

    // Fetch drafts for all cadences in one query
    const cadenceIds = filtered.map(j => j.cadenceId).filter((id): id is string => id != null)
    let draftsByC: Record<string, EmailDraftSummary[]> = {}
    if (cadenceIds.length > 0) {
      const allDrafts = await db
        .select()
        .from(emailDrafts)
        .where(and(...cadenceIds.map(cid => eq(emailDrafts.cadenceId, cid))))
        .orderBy(emailDrafts.dayNumber)
      for (const d of allDrafts) {
        const list = draftsByC[d.cadenceId] ?? []
        list.push({
          id: d.id,
          dayNumber: d.dayNumber as 1 | 3 | 7,
          subject: d.subject,
          bodyHtml: d.bodyHtml,
          originalBodyHtml: d.originalBodyHtml,
          isApproved: d.isApproved,
          status: d.status as EmailDraftStatus,
          scheduledSendAt: d.scheduledSendAt ? String(d.scheduledSendAt) : null,
          sentAt: d.sentAt ? String(d.sentAt) : null,
          openDetectedAt: d.openDetectedAt ? String(d.openDetectedAt) : null,
          clickDetectedAt: d.clickDetectedAt ? String(d.clickDetectedAt) : null,
        })
        draftsByC[d.cadenceId] = list
      }
    }

    const mapped = filtered.map(j => ({
      id:                  j.id,
      title:               j.title,
      company:             j.company,
      location:            j.location,
      source:              j.source,
      sourceUrl:           j.sourceUrl,
      postedAt:            j.postedAt,
      status:              j.status,
      grade:               j.grade,
      score10d:            j.score10d,
      archetype:           j.archetype,
      archetypeConfidence: j.archetypeConfidence,
      createdAt:           j.createdAt,
      emailCadence: j.cadenceId ? ({
        id:                 j.cadenceId,
        status:             j.cadenceStatus as EmailCadenceStatus,
        hiringManagerEmail: j.cadenceHiringEmail,
        emailConfidence:    j.cadenceEmailConfidence,
        approvedAt:         j.cadenceApprovedAt ? String(j.cadenceApprovedAt) : null,
        replyDetectedAt:    j.cadenceReplyAt ? String(j.cadenceReplyAt) : null,
        bounceDetectedAt:   j.cadenceBounceAt ? String(j.cadenceBounceAt) : null,
        drafts:             draftsByC[j.cadenceId] ?? [],
      } satisfies EmailCadenceSummary) : null,
    }))

    return NextResponse.json({ jobs: mapped })
  } catch (e) {
    console.error('[/api/jobs] error:', e)
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
  }
}
