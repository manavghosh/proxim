'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { getResumePipelineJob } from '@/lib/api'

interface Props {
  jobId: string
  /** When true, the pane auto-opens on first mount (e.g. resume_failed —
   *  the user almost certainly wants to see why). */
  autoOpen?: boolean
  /** Called once when the pipeline job transitions to failed status. */
  onBuildFailed?: () => void
  /** Called once when the pipeline job transitions to completed status. */
  onBuildComplete?: () => void
  /** Called whenever the running state changes so the parent can disable Retry. */
  onRunningChange?: (running: boolean) => void
}

interface LogEntry {
  id: string
  level: string
  step: string
  message: string
  createdAt: string
}

const POLL_INTERVAL_MS = 2000
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

function stepIcon(level: string, step: string): string {
  if (level === 'error') return '❌'
  if (level === 'warning') return '⚠️'
  if (step.includes('keyword')) return '🔑'
  if (step.includes('personalise') || step.includes('personalised')) return '✍️'
  if (step.includes('review')) return '🔍'
  if (step.includes('cover_letter')) return '✉️'
  if (step.includes('render')) return '📄'
  if (step.includes('store') || step.includes('complete')) return '🏁'
  return '⚡'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// Inline expand showing the resume_builder progress for one job. Mirrors the
// Pipeline page's PipelineLogPane in look-and-feel; lazy-resolves the latest
// pipeline_job_id for the job, then polls /api/pipeline/{id}/logs.
export function BuildProgressPane({ jobId, autoOpen = false, onBuildFailed, onBuildComplete, onRunningChange }: Props) {
  const [open, setOpen] = useState(autoOpen)
  const [pipelineJobId, setPipelineJobId] = useState<string | null>(null)
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loadingLookup, setLoadingLookup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastLogAtRef = useRef<string | null>(null)
  const fetchingRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Scroll this card's progress pane into view the moment the pane opens.
  // Using a small timeout so the DOM has settled after the expand animation.
  const scrollToPane = useCallback(() => {
    setTimeout(() => {
      if (typeof rootRef.current?.scrollIntoView === 'function') {
        rootRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 150)
  }, [])

  useEffect(() => {
    if (open) scrollToPane()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Notify parent whenever the build transitions between running / not-running.
  useEffect(() => {
    if (pipelineStatus !== null) {
      onRunningChange?.(!TERMINAL_STATUSES.has(pipelineStatus))
    }
  // onRunningChange is a callback prop — omit from deps to avoid infinite loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineStatus])

  // Resolve the latest pipeline_job_id for this job the first time we open.
  useEffect(() => {
    if (!open || pipelineJobId) return
    setLoadingLookup(true)
    setError(null)
    getResumePipelineJob(jobId)
      .then((res) => {
        setPipelineJobId(res.pipelineJobId)
        setPipelineStatus(res.status)
        if (!res.pipelineJobId) setError('No build has run for this job yet.')
        if (res.status === 'failed') onBuildFailed?.()
        if (res.status === 'completed') onBuildComplete?.()
      })
      .catch(() => setError('Failed to look up build job.'))
      .finally(() => setLoadingLookup(false))
  }, [open, jobId, pipelineJobId])

  // Poll logs once we have a pipeline_job_id and the pane is open.
  useEffect(() => {
    if (!open || !pipelineJobId) return
    // If terminal already, fetch once and stop.
    const fetchLogs = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        const since = lastLogAtRef.current
        const url = since
          ? `/api/pipeline/${pipelineJobId}/logs?since=${encodeURIComponent(since)}`
          : `/api/pipeline/${pipelineJobId}/logs`
        const res = await fetch(url)
        if (!res.ok) return
        const data = (await res.json()) as {
          logs: LogEntry[]
          jobStatus: string
          jobError: string | null
        }
        if (data.logs.length > 0) {
          setLogs((prev) => {
            const seen = new Set(prev.map((l) => l.id))
            return [...prev, ...data.logs.filter((l) => !seen.has(l.id))]
          })
          lastLogAtRef.current = data.logs[data.logs.length - 1].createdAt
        }
        setPipelineStatus(data.jobStatus)
        if (TERMINAL_STATUSES.has(data.jobStatus) && intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
          if (data.jobStatus === 'failed') {
            onBuildFailed?.()
            if (data.jobError) {
              setLogs((prev) => [
                ...prev,
                {
                  id: `err-${Date.now()}`,
                  level: 'error',
                  step: 'failed',
                  message: `Build failed: ${data.jobError}`,
                  createdAt: new Date().toISOString(),
                },
              ])
            }
          } else if (data.jobStatus === 'completed') {
            onBuildComplete?.()
          }
        }
      } finally {
        fetchingRef.current = false
      }
    }
    void fetchLogs()
    if (pipelineStatus && !TERMINAL_STATUSES.has(pipelineStatus)) {
      intervalRef.current = setInterval(() => void fetchLogs(), POLL_INTERVAL_MS)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [open, pipelineJobId, pipelineStatus])

  return (
    <div ref={rootRef} className="mt-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((p) => !p)}
        className="text-[11px] text-[#64748b] hover:text-[#94a3b8] px-0 h-auto gap-1"
      >
        {open ? (
          <>Hide build progress <ChevronUp className="w-3 h-3" /></>
        ) : (
          <>Build progress <ChevronDown className="w-3 h-3" /></>
        )}
        {pipelineStatus && !TERMINAL_STATUSES.has(pipelineStatus) && (
          <Loader2 className="w-3 h-3 animate-spin text-[#93c5fd]" />
        )}
      </Button>

      {open && (
        <div className="mt-2 p-3 rounded-md bg-[#080f1e] border border-[#1e2d4a] max-h-72 overflow-y-auto font-mono text-[10px]">
          {loadingLookup && <p className="text-[#64748b]">Looking up build job…</p>}
          {error && !loadingLookup && <p className="text-[#475569]">{error}</p>}
          {!error && !loadingLookup && logs.length === 0 && (
            <p className="text-[#475569]">Waiting for build to start…</p>
          )}
          {logs.map((l) => (
            <div
              key={l.id}
              className={`flex gap-2 ${
                l.level === 'warning'
                  ? 'text-amber-400'
                  : l.level === 'error'
                    ? 'text-red-400'
                    : 'text-[#94a3b8]'
              }`}
            >
              <span className="text-[#475569] shrink-0 tabular-nums">[{formatTime(l.createdAt)}]</span>
              <span className="shrink-0">{stepIcon(l.level, l.step)}</span>
              <span className="break-all">{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
