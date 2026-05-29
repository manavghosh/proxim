'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ChevronDown, XCircle, AlertTriangle, Search, Globe, Building2,
  Database, RefreshCw, Flag, CheckCircle2, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LogEntry {
  id: string
  level: string
  step: string
  message: string
  data?: Record<string, unknown>
  createdAt: string
}

function StepIcon({ level, step }: { level: string; step: string }) {
  const cls = 'w-3 h-3 shrink-0'
  if (level === 'error') return <XCircle className={`${cls} text-destructive`} />
  if (level === 'warning') return <AlertTriangle className={`${cls} text-warning`} />
  if (step === 'review_required') return <Search className={`${cls} text-info`} />
  // Source-specific scraping steps — colour distinguishes each portal at a glance.
  if (step === 'scrape_linkedin' || step === 'fetch_jds_batch') return <Globe className={`${cls} text-[#0A66C2]`} />
  if (step === 'scrape_naukri') return <Globe className={`${cls} text-orange-400`} />
  if (step === 'scrape_iimjobs') return <Globe className={`${cls} text-purple-400`} />
  if (step === 'scrape_monster') return <Globe className={`${cls} text-amber-400`} />
  if (step === 'scrape_careers_page') return <Building2 className={`${cls} text-muted-foreground`} />
  if (step.includes('persist')) return <Database className={`${cls} text-info`} />
  if (step.includes('dedup') || step.includes('normalise')) return <RefreshCw className={`${cls} text-muted-foreground`} />
  if (step === 'write_run_summary' || step === 'write_fetch_summary' || step === 'write_score_summary') return <Flag className={`${cls} text-primary`} />
  if (step.includes('complete')) return <CheckCircle2 className={`${cls} text-success`} />
  return <Zap className={`${cls} text-primary`} />
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

interface Props {
  chainJobIds: string[]        // ordered list of job IDs in the current pipeline chain
  onReviewRequired?: () => void  // called when the user clicks the inline "Review" CTA
  onCancelRunning?: () => void   // called when the user cancels a running job
  cancellingRunning?: boolean    // true while the cancel API call is in flight
  awaitingCancelStop?: boolean   // true after cancel API succeeds — drives longer drain
  onStopped?: () => void         // called once drain completes after a terminal status
}

const POLL_INTERVAL_MS = 2000
const TERMINAL_STATUSES = new Set(['completed', 'failed'])
// After terminal status: keep polling for late-arriving daemon logs.
// Cancel path uses a longer window because the daemon finishes the current LLM
// call before it can detect cancellation — that can take 10–30 s.
const DRAIN_POLLS_NORMAL = 3   // 6 s — catches logs written just before status update
const DRAIN_POLLS_CANCEL = 15  // 30 s — gives in-flight LLM call time to finish

export function PipelineLogPane({
  chainJobIds,
  onReviewRequired,
  onCancelRunning,
  cancellingRunning,
  awaitingCancelStop,
  onStopped,
}: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'polling' | 'error'>('idle')
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const paneRef        = useRef<HTMLDivElement>(null)
  const containerRef   = useRef<HTMLDivElement>(null)
  const bottomRef      = useRef<HTMLDivElement>(null)
  const lastLogAtRef   = useRef<string | null>(null)
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchingRef    = useRef(false)
  const isAtBottomRef  = useRef(true)
  const prevChainRef   = useRef<string[]>([])
  // drain-loop state — reset on each new pipeline run
  const isTerminalRef  = useRef(false)
  const drainCountRef  = useRef(0)
  // stable ref so fetchLogs closure can read the latest prop value
  const awaitingCancelStopRef = useRef(awaitingCancelStop)
  useEffect(() => { awaitingCancelStopRef.current = awaitingCancelStop }, [awaitingCancelStop])

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

  // ── Chain change + polling loop ────────────────────────────────────────────
  useEffect(() => {
    const prev = prevChainRef.current
    const curr = chainJobIds

    if (curr.length === 0) {
      prevChainRef.current = curr
      return
    }

    const activeJobId = curr[curr.length - 1]
    const isReset = curr.length === 1 && (prev.length === 0 || curr[0] !== prev[0])
    const isAppend = curr.length > prev.length && curr[0] === (prev[0] ?? curr[0])

    prevChainRef.current = curr

    if (isReset) {
      setLogs([])
      setRunning(true)
      setConnectionStatus('polling')
      lastLogAtRef.current = null
      fetchingRef.current = false
      isAtBottomRef.current = true
      setShowScrollBtn(false)
      hasScrolledToPaneRef.current = false
      isTerminalRef.current = false
      drainCountRef.current = 0
    } else if (isAppend) {
      lastLogAtRef.current = null
      fetchingRef.current = false
      setRunning(true)
      setConnectionStatus('polling')
      isTerminalRef.current = false
      drainCountRef.current = 0
    }

    if ((isReset || isAppend) && typeof paneRef.current?.scrollIntoView === 'function') {
      paneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      hasScrolledToPaneRef.current = true
    }

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
          // New logs arrived during drain — daemon is still writing; reset counter.
          if (isTerminalRef.current) drainCountRef.current = 0
        }

        if (TERMINAL_STATUSES.has(data.jobStatus)) {
          if (!isTerminalRef.current) {
            // First poll that sees terminal status: stop the spinner, add an
            // error entry for real failures (not cancellations — the daemon logs
            // its own cancellation summary which is more informative).
            isTerminalRef.current = true
            drainCountRef.current = 0
            setRunning(false)
            setConnectionStatus('idle')
            if (
              data.jobStatus === 'failed' &&
              data.jobError &&
              data.jobError !== 'Cancelled by user'
            ) {
              setLogs((prev) => [...prev, {
                id: `err-${Date.now()}`,
                level: 'error',
                step: 'failed',
                message: `Pipeline failed: ${data.jobError}`,
                createdAt: new Date().toISOString(),
              }])
            }
          }

          // Increment drain counter only when no new logs arrived this round.
          if (data.logs.length === 0) drainCountRef.current++

          const drainMax = awaitingCancelStopRef.current
            ? DRAIN_POLLS_CANCEL
            : DRAIN_POLLS_NORMAL
          if (drainCountRef.current >= drainMax) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            onStopped?.()
          }
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
    <div ref={paneRef} className="bg-background border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              running
                ? 'bg-green-500 animate-pulse'
                : connectionStatus === 'error'
                  ? 'bg-amber-500'
                  : 'bg-border-strong'
            }`}
          />
          <span className="text-[11px] font-semibold text-muted-foreground tracking-widest uppercase">
            Pipeline Log
          </span>
          {phaseLabel && (
            <span className="text-[9px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {chainJobIds.length} phases
            </span>
          )}
          {connectionStatus === 'error' && (
            <span className="text-[9px] text-amber-500">retrying…</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {logs.length > 0 && (
            <span className="text-[9px] text-muted-foreground">{logs.length} entries</span>
          )}
          {running && onCancelRunning && (
            <Button
              variant="ghost"
              size="xs"
              className="h-auto px-2 py-0.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30 rounded"
              isLoading={cancellingRunning}
              onClick={onCancelRunning}
            >
              {cancellingRunning ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
          {!running && logs.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="h-auto px-1 py-0 text-[10px] text-muted-foreground"
              onClick={() => { setLogs([]); setShowScrollBtn(false) }}
            >
              Clear
            </Button>
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
            <p className="text-muted-foreground">
              {activeJobId
                ? 'Waiting for pipeline to start…'
                : 'Search for new jobs from the Dashboard to begin'}
            </p>
          ) : (
            logs.map((entry) => {
              const isReviewCta = entry.step === 'review_required' && !!onReviewRequired
              return (
                <div
                  key={entry.id}
                  className={`flex flex-wrap items-center gap-2 ${
                    entry.level === 'warning'
                      ? 'text-amber-400'
                      : entry.level === 'error'
                        ? 'text-red-400'
                        : isReviewCta
                          ? 'text-cyan-300'
                          : 'text-muted-foreground'
                  }`}
                >
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    [{formatTime(entry.createdAt)}]
                  </span>
                  <span className="shrink-0 flex items-center"><StepIcon level={entry.level} step={entry.step} /></span>
                  <span className="break-all">{entry.message}</span>
                  {isReviewCta && (
                    <Button
                      variant="link"
                      size="xs"
                      className="h-auto p-0 text-cyan-300 hover:text-cyan-200"
                      onClick={() => onReviewRequired?.()}
                    >
                      Review →
                    </Button>
                  )}
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom button — only shows when scrolled up */}
        {showScrollBtn && (
          <Button
            variant="outline"
            size="xs"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 gap-1 rounded-full border-border-strong bg-border text-muted-foreground text-[10px] shadow-lg hover:bg-border-strong"
          >
            <ChevronDown className="w-3 h-3" />
            Latest
          </Button>
        )}
      </div>
    </div>
  )
}
