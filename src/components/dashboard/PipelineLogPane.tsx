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

export function PipelineLogPane({ jobId }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!jobId) return

    setLogs([])
    setRunning(true)

    const es = new EventSource(`/api/pipeline/${jobId}/stream`)

    es.addEventListener('log_entry', (e: MessageEvent) => {
      const entry = JSON.parse(e.data) as LogEntry
      setLogs((prev) => [...prev, entry])
    })

    es.addEventListener('completed', () => {
      setRunning(false)
      es.close()
    })

    es.addEventListener('failed', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { error?: string }
        if (payload.error) {
          setLogs((prev) => [...prev, {
            id: crypto.randomUUID(),
            level: 'error',
            step: 'failed',
            message: `Pipeline failed: ${payload.error}`,
            createdAt: new Date().toISOString(),
          }])
        }
      } catch { /* ignore parse errors */ }
      setRunning(false)
      es.close()
    })

    return () => es.close()
  }, [jobId])

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  if (!jobId && logs.length === 0) return null

  return (
    <div className="bg-[#060d1f] border border-[#1e2d4a] rounded-xl overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2d4a]">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              running ? 'bg-green-500 animate-pulse' : 'bg-[#334155]'
            }`}
          />
          <span className="text-[11px] font-semibold text-[#94a3b8] tracking-widest uppercase">
            Pipeline Log
          </span>
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
          <p className="text-[#334155]">Waiting for pipeline to start…</p>
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
