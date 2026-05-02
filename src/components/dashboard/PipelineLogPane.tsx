'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'

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
  if (step === 'write_run_summary' || step === 'write_fetch_summary' || step === 'write_score_summary') return '🏁'
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
  chainJobIds: string[]   // ordered list of job IDs in the current pipeline chain
}

const POLL_INTERVAL_MS = 2000
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

export function PipelineLogPane({ chainJobIds }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'polling' | 'error'>('idle')
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const paneRef       = useRef<HTMLDivElement>(null)  // outer pane — scrolled into view on first log
  const containerRef  = useRef<HTMLDivElement>(null)
  const bottomRef     = useRef<HTMLDivElement>(null)
  const lastLogAtRef  = useRef<string | null>(null)
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchingRef   = useRef(false)
  const isAtBottomRef = useRef(true)   // tracks whether user is scrolled to bottom
  // track the chain snapshot at last render so we can detect reset vs append
  const prevChainRef  = useRef<string[]>([])

  // ── Scroll tracking ────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    isAtBottomRef.current = atBottom
    setShowScrollBtn(!atBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    isAtBottomRef.current = true
    setShowScrollBtn(false)
  }, [])

  // Scroll the pane into the viewport when the first log entry arrives.
  // Does NOT scroll inside the log pane — the user controls that manually.
  const hasScrolledToPaneRef = useRef(false)
  useEffect(() => {
    if (logs.length > 0 && !hasScrolledToPaneRef.current) {
      hasScrolledToPaneRef.current = true
      if (typeof paneRef.current?.scrollIntoView === 'function') {
        paneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    if (logs.length === 0) {
      hasScrolledToPaneRef.current = false
    }
  }, [logs.length])

  // ── Chain change logic ─────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevChainRef.current
    const curr = chainJobIds

    // Nothing to do
    if (curr.length === 0) {
      prevChainRef.current = curr
      return
    }

    const activeJobId = curr[curr.length - 1]
    const isReset = curr.length === 1 && (prev.length === 0 || curr[0] !== prev[0])
    const isAppend = curr.length > prev.length && curr[0] === (prev[0] ?? curr[0])

    prevChainRef.current = curr

    if (isReset) {
      // Entirely new pipeline run — clear everything and start fresh
      setLogs([])
      setRunning(true)
      setConnectionStatus('polling')
      lastLogAtRef.current = null
      fetchingRef.current = false
      isAtBottomRef.current = true
      setShowScrollBtn(false)
    } else if (isAppend) {
      // A follow-up job was added to the chain — keep existing logs,
      // reset polling cursor so we start fetching the new job from the beginning
      lastLogAtRef.current = null
      fetchingRef.current = false
      setRunning(true)
      setConnectionStatus('polling')
    }

    // Clear any running interval before starting a new one
    if (intervalRef.current) clearInterval(intervalRef.current)

    const fetchLogs = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        const since = lastLogAtRef.current
        const url = since
          ? `/api/pipeline/${activeJobId}/logs?since=${encodeURIComponent(since)}`
          : `/api/pipeline/${activeJobId}/logs`

        const res = await fetch(url)
        if (!res.ok) return

        const data = await res.json() as {
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
          setConnectionStatus('polling')
        }

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
      } finally {
        fetchingRef.current = false
      }
    }

    void fetchLogs()
    intervalRef.current = setInterval(() => { void fetchLogs() }, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainJobIds.join(',')])

  const activeJobId = chainJobIds[chainJobIds.length - 1] ?? null
  const phaseLabel = chainJobIds.length > 1
    ? `Phase ${chainJobIds.length} of ${chainJobIds.length}`
    : null

  return (
    <div ref={paneRef} className="bg-[#060d1f] border border-[#1e2d4a] rounded-xl overflow-hidden mt-4">
      {/* Header */}
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
          {phaseLabel && (
            <span className="text-[9px] text-[#475569] bg-[#0d1829] px-2 py-0.5 rounded">
              {chainJobIds.length} phases
            </span>
          )}
          {connectionStatus === 'error' && (
            <span className="text-[9px] text-amber-500">retrying…</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {logs.length > 0 && (
            <span className="text-[9px] text-[#334155]">{logs.length} entries</span>
          )}
          {!running && logs.length > 0 && (
            <button
              onClick={() => { setLogs([]); setShowScrollBtn(false) }}
              className="text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Scrollable log body */}
      <div className="relative">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-[240px] overflow-y-auto p-3 font-mono text-[11px] space-y-1 scroll-smooth"
        >
          {logs.length === 0 ? (
            <p className="text-[#334155]">
              {activeJobId
                ? 'Waiting for pipeline to start…'
                : 'Click ▶ Run Pipeline to begin job discovery'}
            </p>
          ) : (
            logs.map((entry, i) => {
              // Insert a phase divider when we cross into a new job's logs
              // (detected by a big timestamp gap or the phase count)
              return (
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
                  <span className="text-[#475569] shrink-0 tabular-nums">
                    [{formatTime(entry.createdAt)}]
                  </span>
                  <span className="shrink-0">{stepIcon(entry.level, entry.step)}</span>
                  <span className="break-all">{entry.message}</span>
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom button — only shows when scrolled up */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#1e2d4a] hover:bg-[#1e3a5f] text-[#94a3b8] text-[10px] px-2 py-1 rounded-full border border-[#334155] transition-colors shadow-lg"
          >
            <ChevronDown className="w-3 h-3" />
            Latest
          </button>
        )}
      </div>
    </div>
  )
}
