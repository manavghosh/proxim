import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { outreachTargets, pipelineJobs } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ targetId: string }> }
) {
  try {
    const { targetId } = await params
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [target] = await db
      .select({ id: outreachTargets.id, candidateId: outreachTargets.candidateId,
                jobId: outreachTargets.jobId, status: outreachTargets.status })
      .from(outreachTargets)
      .where(and(eq(outreachTargets.id, targetId), eq(outreachTargets.candidateId, candidateId)))
      .limit(1)

    if (!target) return NextResponse.json({ error: 'Outreach target not found' }, { status: 404 })

    const regenerableStatuses = ['notes_ready', 'failed'] as const
    if (!(regenerableStatuses as readonly string[]).includes(target.status)) {
      return NextResponse.json(
        { error: `Cannot regenerate from status '${target.status}'` }, { status: 409 }
      )
    }

    await db.update(outreachTargets)
      .set({ status: 'generating' })
      .where(eq(outreachTargets.id, targetId))

    const [pjob] = await db.insert(pipelineJobs)
      .values({
        jobType:     'linkedin_note_regen',
        candidateId,
        payload:     { target_id: targetId, job_id: target.jobId, candidate_id: candidateId },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({
      targetId,
      status:  'generating',
      pipelineJobId: pjob.id,
      message: 'Regenerating note variants. Refresh in ~30 seconds.',
    })
  } catch (e) {
    console.error('[outreach/regenerate] POST error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
