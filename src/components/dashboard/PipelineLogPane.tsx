'use client'

import { useEffect, useRef, useState } from 'react'

interface LogEntry {
  id: string
  level: string
  step: string
  message: string
  data?: Record<string, unknown>
  createdAt: string
}

function stepIcon(level: string, step: string): string {
  if (level === 'error') return '❌'
  if (level === 'warning') return '⚠️'
  if (step.includes('persist')) return '💾'
  if (step.includes('dedup') || step.includes('normalise')) return '🔄'
  if (step === 'write_run_summary') return '🏁'
  if (step.includes('complete')) return '✅'
  return '⚡'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

interface Props {
  jobId: string | null
}

const POLL_INTERVAL_MS = 2000
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

export function PipelineLogPane({ jobId }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'polling' | 'error'>('idle')
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastLogAtRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId) return

    // Reset state for new job
    setLogs([])
    setRunning(true)
    setConnectionStatus('polling')
    lastLogAtRef.current = null

    const fetchLogs = async () => {
      try {
        const since = lastLogAtRef.current
        const url = since
          ? `/api/pipeline/${jobId}/logs?since=${encodeURIComponent(since)}`
          : `/api/pipeline/${jobId}/logs`

        const res = await fetch(url)
        if (!res.ok) return // silent retry on non-200

        const data = await res.json() as {
          logs: LogEntry[]
          jobStatus: string
          jobError: string | null
        }

        if (data.logs.length > 0) {
          setLogs((prev) => [...prev, ...data.logs])
          lastLogAtRef.current = data.logs[data.logs.length - 1].createdAt
          setConnectionStatus('polling')
        }

        // Stop polling when terminal status reached
        if (TERMINAL_STATUSES.has(data.jobStatus)) {
          if (data.jobStatus === 'failed' && data.jobError) {
            setLogs((prev) => [...prev, {
              id: `err-${Date.now()}`,
              level: 'error',
              step: 'failed',
              message: `Pipeline failed: ${data.jobError}`,
              createdAt: new Date().toISOString(),
            }])
          }
          setRunning(false)
          setConnectionStatus('idle')
          if (intervalRef.current) clearInterval(intervalRef.current)
        }
      } catch {
        setConnectionStatus('error')
        // Keep polling — transient error, will recover next tick
      }
    }

    // Poll immediately then on interval
    void fetchLogs()
    intervalRef.current = setInterval(() => { void fetchLogs() }, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobId])

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  return (
    <div className="bg-[#060d1f] border border-[#1e2d4a] rounded-xl overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2d4a]">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              running
                ? 'bg-green-500 animate-pulse'
                : connectionStatus === 'error'
                  ? 'bg-amber-500'
                  : 'bg-[#334155]'
            }`}
          />
          <span className="text-[11px] font-semibold text-[#94a3b8] tracking-widest uppercase">
            Pipeline Log
          </span>
          {connectionStatus === 'error' && (
            <span className="text-[9px] text-amber-500">retrying…</span>
          )}
        </div>
        {!running && logs.length > 0 && (
          <button
            onClick={() => setLogs([])}
            className="text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className="max-h-[320px] overflow-y-auto p-3 font-mono text-[11px] space-y-1">
        {logs.length === 0 ? (
          <p className="text-[#334155]">
            {jobId ? 'Waiting for pipeline to start…' : 'Click ▶ Run Pipeline to begin job discovery'}
          </p>
        ) : (
          logs.map((entry) => (
            <div
              key={entry.id}
              className={`flex gap-2 ${
                entry.level === 'warning'
                  ? 'text-amber-400'
                  : entry.level === 'error'
                    ? 'text-red-400'
                    : 'text-[#94a3b8]'
              }`}
            >
              <span className="text-[#475569] shrink-0">
                [{formatTime(entry.createdAt)}]
              </span>
              <span className="shrink-0">{stepIcon(entry.level, entry.step)}</span>
              <span className="break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
