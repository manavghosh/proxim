import { NextResponse } from 'next/server'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs, pipelineRuns, scanHistory } from '@/db/schema'
import { getCandidateById } from '@/lib/cv-service'

function detectSource(url: string): 'linkedin' | 'naukri' | 'manual' {
  if (url.includes('linkedin.com/jobs')) return 'linkedin'
  if (url.includes('naukri.com')) return 'naukri'
  return 'manual'
}

function normaliseUrl(url: string): string {
  // Strip LinkedIn tracking params — keep just the base job URL.
  // Alert / search URLs carry currentJobId as a query param — convert to
  // a direct /jobs/view/{id} URL so the scraper hits the right page.
  try {
    const u = new URL(url)
    if (u.hostname.includes('linkedin.com')) {
      const currentJobId = u.searchParams.get('currentJobId')
      if (currentJobId) {
        return `https://www.linkedin.com/jobs/view/${currentJobId}`
      }
      return `https://www.linkedin.com${u.pathname.replace(/\/$/, '')}`
    }
    return url.split('?')[0]
  } catch {
    return url.trim()
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }

    const body = await request.json()
    const rawText: string = body.urls ?? ''

    // Parse newline-separated URLs — strip blanks and duplicates
    const parsed = [...new Set(
      rawText
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.startsWith('http'))
        .map(normaliseUrl)
    )]

    if (parsed.length === 0) {
      return NextResponse.json({ error: 'No valid URLs found' }, { status: 400 })
    }
    if (parsed.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 URLs per import' }, { status: 400 })
    }

    const candidate = await getCandidateById(candidateId)
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    // Skip URLs already in scan_history for this candidate (prevent duplicates)
    const existing = await db
      .select({ url: scanHistory.url })
      .from(scanHistory)
      .where(
        and(
          eq(scanHistory.candidateId, candidateId),
          inArray(scanHistory.url, parsed)
        )
      )
    const existingUrls = new Set(existing.map(r => r.url))
    const newUrls = parsed.filter(u => !existingUrls.has(u))

    if (newUrls.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: parsed.length,
        message: 'All URLs already exist in your Scorecard',
      })
    }

    // Create a pipeline_run to track this import
    const [pj] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'import_jobs',
        candidateId,
        payload: {},
      })
      .returning({ id: pipelineJobs.id })

    const [pr] = await db
      .insert(pipelineRuns)
      .values({
        pipelineJobId: pj.id,
        candidateId,
        status: 'running',
      })
      .returning({ id: pipelineRuns.id })

    // Insert placeholder job rows — title/company/jd filled in by Python daemon
    const now = new Date()
    const insertedIds: string[] = []

    for (const sourceUrl of newUrls) {
      const source = detectSource(sourceUrl)
      const [inserted] = await db
        .insert(jobs)
        .values({
          candidateId,
          pipelineRunId: pr.id,
          title: 'Importing…',
          company: 'Unknown',
          jdRaw: '',
          source,
          sourceUrl,
          status: 'discovered',
        })
        .returning({ id: jobs.id })
      insertedIds.push(inserted.id)
    }

    // Record in scan_history to prevent future duplicates
    for (let i = 0; i < newUrls.length; i++) {
      await db.insert(scanHistory).values({
        candidateId,
        url: newUrls[i],
        jobId: insertedIds[i],
      }).onConflictDoNothing()
    }

    // Update pipeline_job payload with the job IDs to process
    await db
      .update(pipelineJobs)
      .set({ payload: { job_ids: insertedIds, candidate_id: candidateId } })
      .where(eq(pipelineJobs.id, pj.id))

    return NextResponse.json({
      imported: newUrls.length,
      skipped: existingUrls.size,
      pipelineJobId: pj.id,
      jobIds: insertedIds,
    }, { status: 201 })

  } catch (e) {
    console.error('[/api/jobs/import] error:', e)
    return NextResponse.json({ error: 'Failed to import jobs' }, { status: 500 })
  }
}
