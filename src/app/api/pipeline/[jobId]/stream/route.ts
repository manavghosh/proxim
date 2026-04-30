import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs, pipelineRuns } from '@/db/schema'

const TERMINAL_STATUSES = new Set(['completed', 'failed'])
const POLL_INTERVAL_MS = 2000

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  // Verify job exists
  const [job] = await db
    .select({ id: pipelineJobs.id })
    .from(pipelineJobs)
    .where(eq(pipelineJobs.id, jobId))
    .limit(1)

  if (!job) {
    return new Response(JSON.stringify({ error: 'Pipeline job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const pushEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      let lastStatus = ''

      const poll = async () => {
        try {
          const [currentJob] = await db
            .select()
            .from(pipelineJobs)
            .where(eq(pipelineJobs.id, jobId))
            .limit(1)

          if (!currentJob) {
            controller.close()
            return
          }

          const [run] = await db
            .select()
            .from(pipelineRuns)
            .where(eq(pipelineRuns.pipelineJobId, jobId))
            .limit(1)

          if (currentJob.status !== lastStatus) {
            lastStatus = currentJob.status

            if (TERMINAL_STATUSES.has(currentJob.status)) {
              pushEvent(currentJob.status, {
                status: currentJob.status,
                jobsDiscovered: run?.jobsDiscovered ?? 0,
                jobsDeduplicated: run?.jobsDeduplicated ?? 0,
                error: currentJob.error,
              })
              controller.close()
              return
            }

            pushEvent('status_update', {
              status: currentJob.status,
              jobsDiscovered: run?.jobsDiscovered ?? 0,
              sourcesSuccessful: run?.sourcesSuccessful ?? 0,
            })
          }

          setTimeout(() => { void poll() }, POLL_INTERVAL_MS)
        } catch {
          controller.close()
        }
      }

      await poll()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
