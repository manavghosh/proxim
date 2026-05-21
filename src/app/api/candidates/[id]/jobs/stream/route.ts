import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, emailCadences, outreachTargets } from '@/db/schema'

const POLL_INTERVAL_MS = 5000
const IDLE_TIMEOUT_MS  = 300000   // 5 minutes — was 60s

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
          const since = new Date(lastSeenAt)

          const [changedJobs, changedCadences, changedOutreach] = await Promise.all([
            db.select({ id: jobs.id })
              .from(jobs)
              .where(and(eq(jobs.candidateId, candidateId), gt(jobs.updatedAt, since))),
            db.select({ id: emailCadences.id })
              .from(emailCadences)
              .where(and(eq(emailCadences.candidateId, candidateId), gt(emailCadences.updatedAt, since))),
            db.select({ id: outreachTargets.id })
              .from(outreachTargets)
              .where(and(eq(outreachTargets.candidateId, candidateId), gt(outreachTargets.updatedAt, since))),
          ])

          const hasChanges =
            changedJobs.length > 0 ||
            changedCadences.length > 0 ||
            changedOutreach.length > 0

          if (hasChanges) {
            lastSeenAt = new Date().toISOString()
            idleMs = 0
            controller.enqueue(
              encode('jobs_arrived', {
                count:  changedJobs.length,
                jobIds: changedJobs.map(j => j.id),
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
      'Content-Type':    'text/event-stream',
      'Cache-Control':   'no-cache',
      Connection:        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
