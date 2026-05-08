import { and, eq, gt, ne, notInArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { jobs } from '@/db/schema'

type JobStatus = 'awaiting' | 'approved' | 'rejected' | 'snoozed' | 'discovered' | 'scored' | 'score_failed' | 'resume_failed' | 'resume_ready' | 'submitted'

const POLL_INTERVAL_MS = 5000
const IDLE_TIMEOUT_MS = 60000

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: candidateId } = await params

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (event: string, data: unknown) => {
        const json = JSON.stringify(data)
        return new TextEncoder().encode(`event: ${event}\ndata: ${json}\n\n`)
      }

      let lastSeenAt = new Date().toISOString()
      let idleMs = 0

      const poll = async () => {
        try {
          const newJobs = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(
              and(
                eq(jobs.candidateId, candidateId),
                ne(jobs.grade, 'F'),
                notInArray(jobs.status, ['discovered', 'score_failed', 'rejected'] as JobStatus[]),
                gt(jobs.createdAt, sql`${lastSeenAt}::timestamptz`)
              )
            )

          if (newJobs.length > 0) {
            lastSeenAt = new Date().toISOString()
            idleMs = 0
            controller.enqueue(
              encode('jobs_arrived', {
                count: newJobs.length,
                jobIds: newJobs.map(j => j.id),
              })
            )
          } else {
            idleMs += POLL_INTERVAL_MS
            if (idleMs >= IDLE_TIMEOUT_MS) {
              controller.enqueue(encode('idle', {}))
              controller.close()
              return
            }
          }

          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
          poll()
        } catch {
          controller.close()
        }
      }

      poll()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
