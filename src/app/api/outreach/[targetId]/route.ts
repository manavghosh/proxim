import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { outreachTargets, jobs } from '@/db/schema'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ targetId: string }> }
) {
  try {
    const { targetId } = await params
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [row] = await db
      .select({
        id:           outreachTargets.id,
        candidateId:  outreachTargets.candidateId,
        jobId:        outreachTargets.jobId,
        status:       outreachTargets.status,
        name:         outreachTargets.name,
        linkedinUrl:  outreachTargets.linkedinUrl,
        title:        outreachTargets.title,
        seniority:    outreachTargets.seniority,
        noteA:        outreachTargets.noteA,
        noteB:        outreachTargets.noteB,
        selectedNote: outreachTargets.selectedNote,
        editedNote:   outreachTargets.editedNote,
        company:      outreachTargets.company,
        enrichmentJson: outreachTargets.enrichmentJson,
        sentAt:       outreachTargets.sentAt,
        acceptedAt:   outreachTargets.acceptedAt,
        errorMessage: outreachTargets.errorMessage,
      })
      .from(outreachTargets)
      .leftJoin(jobs, eq(jobs.id, outreachTargets.jobId))
      .where(eq(outreachTargets.id, targetId))
      .limit(1)

    if (!row) return NextResponse.json({ error: 'Outreach target not found' }, { status: 404 })
    if (row.candidateId !== candidateId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({
      ...row,
      sentAt:     row.sentAt     ? String(row.sentAt)     : null,
      acceptedAt: row.acceptedAt ? String(row.acceptedAt) : null,
    })
  } catch (e) {
    console.error('[outreach/[targetId]] GET error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
