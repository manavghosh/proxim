import { NextResponse } from 'next/server'
import { and, eq, ne, notInArray } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, hitlCheckpoints, outreachTargets, emailCadences, emailDrafts } from '@/db/schema'
import type { OutreachTargetSummary, OutreachStatus, EmailCadenceSummary, EmailCadenceStatus, EmailDraftSummary, EmailDraftStatus } from '@/types/candidate'

type JobStatus = 'awaiting' | 'approved' | 'rejected' | 'snoozed' | 'discovered' | 'scored' | 'score_failed' | 'resume_failed' | 'resume_ready' | 'submitted'
// Pipeline page is the *decision queue*: it only shows jobs that need a
// human decision — i.e. `scored` and `awaiting`. Everything post-decision
// (approved/rejected/snoozed/resume_*/submitted) lives on the Applications
// page. Pre-decision (`discovered`, `score_failed`) lives in the pipeline log.
const EXCLUDED_STATUSES: JobStatus[] = [
  'discovered', 'score_failed', 'rejected',
  'approved', 'snoozed', 'submitted', 'resume_ready', 'resume_failed',
]

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
    const gradesParam = url.searchParams.get('grades')
    const sort = url.searchParams.get('sort') ?? 'score'

    // F is always excluded from the pipeline review queue (DB WHERE enforces it).
    // E is included — it passed both gates and is reviewable, just a poor fit.
    const VALID_GRADES = ['A', 'B', 'C', 'D', 'E'] as const
    type ValidGrade = typeof VALID_GRADES[number]
    const isValidGrade = (g: string): g is ValidGrade =>
      (VALID_GRADES as readonly string[]).includes(g)

    // New clients pass ?grades=A,B,C,D (multi-select). Legacy clients still pass
    // ?filter=A|A+B|all — translate that here so saved preferences don't break.
    let gradesAllowed: Set<ValidGrade>
    if (gradesParam !== null) {
      gradesAllowed = new Set(gradesParam.split(',').filter(isValidGrade))
    } else if (filter === 'A') {
      gradesAllowed = new Set(['A'])
    } else if (filter === 'A+B') {
      gradesAllowed = new Set(['A', 'B'])
    } else {
      gradesAllowed = new Set(VALID_GRADES)
    }

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
        // F5 outreach
        outreachId:           outreachTargets.id,
        outreachStatus:       outreachTargets.status,
        outreachName:         outreachTargets.name,
        outreachLinkedinUrl:  outreachTargets.linkedinUrl,
        outreachTitle:        outreachTargets.title,
        outreachSeniority:    outreachTargets.seniority,
        outreachNoteA:        outreachTargets.noteA,
        outreachNoteB:        outreachTargets.noteB,
        outreachSelectedNote: outreachTargets.selectedNote,
        outreachEditedNote:   outreachTargets.editedNote,
        outreachSentAt:       outreachTargets.sentAt,
        outreachAcceptedAt:   outreachTargets.acceptedAt,
        outreachErrorMessage: outreachTargets.errorMessage,
        // F6 email cadence (cadence-level fields only; drafts fetched separately)
        cadenceId:              emailCadences.id,
        cadenceStatus:          emailCadences.status,
        cadenceHiringEmail:     emailCadences.hiringManagerEmail,
        cadenceEmailConfidence: emailCadences.emailConfidence,
        cadenceApprovedAt:      emailCadences.approvedAt,
        cadenceReplyAt:         emailCadences.replyDetectedAt,
        cadenceBounceAt:        emailCadences.bounceDetectedAt,
      })
      .from(jobs)
      .leftJoin(hitlCheckpoints, eq(hitlCheckpoints.jobId, jobs.id))
      .leftJoin(outreachTargets, eq(outreachTargets.jobId, jobs.id))
      .leftJoin(emailCadences, eq(emailCadences.jobId, jobs.id))
      .where(
        and(
          eq(jobs.candidateId, candidateId),
          ne(jobs.grade, 'F'),
          notInArray(jobs.status, EXCLUDED_STATUSES)
        )
      )
      .orderBy(jobs.createdAt)

    // Fetch all drafts for cadences in this result set
    const cadenceIds = rows.map(r => r.cadenceId).filter((id): id is string => id != null)
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

    // Always exclude F-grade as a safety net (DB WHERE also handles this)
    let filtered = rows.filter(r => r.grade !== 'F')

    // Apply grade filter (multi-select set built above)
    filtered = filtered.filter(r => r.grade != null && gradesAllowed.has(r.grade as ValidGrade))

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
      outreachTarget: r.outreachId
        ? ({
            id:           r.outreachId,
            status:       r.outreachStatus as OutreachStatus,
            name:         r.outreachName,
            linkedinUrl:  r.outreachLinkedinUrl,
            title:        r.outreachTitle,
            seniority:    r.outreachSeniority,
            noteA:        r.outreachNoteA,
            noteB:        r.outreachNoteB,
            selectedNote: r.outreachSelectedNote as 'A' | 'B' | null,
            editedNote:   r.outreachEditedNote,
            sentAt:       r.outreachSentAt ? String(r.outreachSentAt) : null,
            acceptedAt:   r.outreachAcceptedAt ? String(r.outreachAcceptedAt) : null,
            errorMessage: r.outreachErrorMessage,
          } satisfies OutreachTargetSummary)
        : null,
      emailCadence: r.cadenceId
        ? ({
            id:                 r.cadenceId,
            status:             r.cadenceStatus as EmailCadenceStatus,
            hiringManagerEmail: r.cadenceHiringEmail,
            emailConfidence:    r.cadenceEmailConfidence,
            approvedAt:         r.cadenceApprovedAt ? String(r.cadenceApprovedAt) : null,
            replyDetectedAt:    r.cadenceReplyAt ? String(r.cadenceReplyAt) : null,
            bounceDetectedAt:   r.cadenceBounceAt ? String(r.cadenceBounceAt) : null,
            drafts:             draftsByC[r.cadenceId] ?? [],
          } satisfies EmailCadenceSummary)
        : null,
    }))

    return NextResponse.json({ jobs: mapped, total: mapped.length })
  } catch (e) {
    console.error('[/api/candidates/[id]/jobs] GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}
