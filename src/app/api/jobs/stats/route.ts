import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

export async function GET() {
  try {
    const [row] = await db
      .select({ count: sql<string>`count(*)` })
      .from(jobs)
      .where(eq(jobs.status, 'score_failed'))

    return NextResponse.json({ scoreFailed: Number(row?.count ?? 0) })
  } catch (e) {
    console.error('[jobs/stats] error:', e)
    return NextResponse.json({ scoreFailed: 0 })
  }
}
