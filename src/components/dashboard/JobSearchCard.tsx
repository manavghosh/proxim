'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Zap, AlertTriangle, CheckCircle2, Check, Loader2, Circle, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { triggerPipeline, getPipelineStatus } from '@/lib/api'
import type { LastSearch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JobSearchCardProps {
  candidateId: string
  lastSearch: LastSearch | null
  awaitingReview: number
  scoreFailed: number
  onSearchComplete: () => void
  onOpenBatchSheet: () => void
}

type Mode = 'idle' | 'running' | 'complete' | 'error'

interface StepState {
  status: 'pending' | 'active' | 'done'
  count: string | null
  label: string
}

interface CompleteResult {
  discovered: number
  newJobs: number
  duplicatesSkipped: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_TYPE_TO_STEP: Record<string, number> = {
  discovery_only: 0,
  fetch_jds: 1,
  score_jobs: 2,
}

const STEP_LABELS = ['Discovering', 'Fetching JDs', 'Scoring']

const INITIAL_STEPS: StepState[] = STEP_LABELS.map((label) => ({
  status: 'pending',
  count: null,
  label,
}))

// ─── Time helpers ─────────────────────────────────────────────────────────────

function hoursAgo(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60)
}

function formatRelative(lastSearchAt: string | null): string {
  if (!lastSearchAt) return 'No searches yet'
  const h = hoursAgo(lastSearchAt)
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 24) return `${Math.round(h)}h ago`
  if (h < 48) return 'Yesterday'
  return `${Math.round(h / 24)} days ago`
}

function formatAbsolute(lastSearchAt: string | null): string | null {
  if (!lastSearchAt) return null
  return new Date(lastSearchAt).toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobSearchCard({
  candidateId,
  lastSearch,
  awaitingReview,
  scoreFailed,
  onSearchComplete,
  onOpenBatchSheet,
}: JobSearchCardProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [steps, setSteps] = useState<StepState[]>(INITIAL_STEPS)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null)
  const [dismissTimer, setDismissTimer] = useState<number>(8)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const discoveryRunRef = useRef<{ jobsDiscovered: number; jobsDeduplicated: number } | null>(null)
  const stepCountsRef = useRef<string[]>(['', '', ''])
  // True when this card resumed an in-flight run from the sessionStorage marker
  // (user returned to the dashboard mid-search). Discovery counts aren't
  // available on a mid-chain resume, so we skip the count summary on completion.
  const rehydratedRef = useRef(false)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
      if (dismissRef.current) clearInterval(dismissRef.current)
    }
  }, [])

  // Auto-dismiss complete mode after 8 seconds
  useEffect(() => {
    if (mode !== 'complete') return
    setDismissTimer(8)
    const interval = setInterval(() => {
      setDismissTimer((t) => {
        if (t <= 1) {
          clearInterval(interval)
          setMode('idle')
          return 0
        }
        return t - 1
      })
    }, 1000)
    dismissRef.current = interval
    return () => clearInterval(interval)
  }, [mode])

  // ─── Polling ───────────────────────────────────────────────────────────────

  const poll = useCallback(
    (jobId: string, rescoreOnly: boolean) => {
      pollRef.current = setTimeout(async () => {
        try {
          const status = await getPipelineStatus(jobId)
          const stepIdx = JOB_TYPE_TO_STEP[status.jobType] ?? 0

          // Fix 1: track discovery_only counts separately
          if (status.jobType === 'discovery_only' && status.pipelineRun) {
            discoveryRunRef.current = {
              jobsDiscovered: status.pipelineRun.jobsDiscovered,
              jobsDeduplicated: status.pipelineRun.jobsDeduplicated,
            }
          }

          // Update step count ref for the current active step
          const discovered = status.pipelineRun?.jobsDiscovered ?? 0
          if (stepIdx === 0) {
            stepCountsRef.current[0] = discovered > 0 ? `${discovered} found` : 'Searching…'
          }

          setSteps(prev => prev.map((s, i) => {
            if (i < stepIdx) return { ...s, status: 'done', count: stepCountsRef.current[i] || 'Done' }
            if (i === stepIdx) return { ...s, status: 'active', count: stepCountsRef.current[stepIdx] || 'Running…' }
            return { ...s, status: 'pending', count: 'Waiting…' }
          }))

          if (status.followUpJobId) {
            // Follow the chain
            poll(status.followUpJobId, rescoreOnly)
            return
          }

          if (status.status === 'completed') {
            if (typeof window !== 'undefined') sessionStorage.removeItem(`proxim-search-${candidateId}`)
            // Resumed run: discovery counts are unknown mid-chain, so skip the
            // (misleading) "0 new jobs" summary card and just refresh stats.
            if (rehydratedRef.current) {
              rehydratedRef.current = false
              onSearchComplete()
              setMode('idle')
              return
            }
            if (rescoreOnly) {
              setCompleteResult({ discovered: 0, newJobs: 0, duplicatesSkipped: 0 })
            } else {
              // Fix 1: use discoveryRunRef if available (score_jobs doesn't record discovery counts)
              const runData = discoveryRunRef.current ?? {
                jobsDiscovered: status.pipelineRun?.jobsDiscovered ?? 0,
                jobsDeduplicated: status.pipelineRun?.jobsDeduplicated ?? 0,
              }
              setCompleteResult({
                discovered: runData.jobsDiscovered + runData.jobsDeduplicated,
                newJobs: runData.jobsDiscovered,
                duplicatesSkipped: runData.jobsDeduplicated,
              })
            }
            setMode('complete')
            // Fix 4: call onSearchComplete immediately on completion, not after 8s delay
            onSearchComplete()
            return
          }

          if (status.status === 'failed') {
            if (typeof window !== 'undefined') sessionStorage.removeItem(`proxim-search-${candidateId}`)
            setErrorMsg('Pipeline run failed. Please try again.')
            setMode('error')
            return
          }

          // Still running — poll again
          poll(jobId, rescoreOnly)
        } catch (err) {
          if (typeof window !== 'undefined') sessionStorage.removeItem(`proxim-search-${candidateId}`)
          setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
          setMode('error')
        }
      }, 5000)
    },
    [onSearchComplete],
  )

  // G4: if the user navigated away mid-search and came back, resume the live
  // step view from the sessionStorage marker instead of showing an idle card.
  useEffect(() => {
    if (typeof window === 'undefined' || mode !== 'idle') return
    const raw = sessionStorage.getItem(`proxim-search-${candidateId}`)
    if (!raw) return
    let id = raw
    try {
      const parsed = JSON.parse(raw) as { id?: string }
      if (parsed && typeof parsed === 'object') id = parsed.id ?? raw
    } catch { /* legacy bare string */ }
    if (!id) return
    rehydratedRef.current = true
    setSteps(STEP_LABELS.map((label, i) => ({ label, status: i === 0 ? 'active' : 'pending', count: null })))
    setMode('running')
    poll(id, false)
  // Mount-only resume: re-running on every dep change would restart the poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId])

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handleSearch() {
    // Fix 2: guard against double-click concurrent polls
    if (mode !== 'idle') return
    discoveryRunRef.current = null  // Fix 1: reset stale discovery data
    stepCountsRef.current = ['', '', '']
    try {
      const { jobId } = await triggerPipeline('discovery_only', candidateId)
      // Persist a marker so the Scorecard can show live "searching & scoring"
      // progress if the user navigates there before this run finishes.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`proxim-search-${candidateId}`, JSON.stringify({ id: jobId }))
      }
      setSteps(
        STEP_LABELS.map((label, i) => ({
          label,
          status: i === 0 ? 'active' : 'pending',
          count: null,
        })),
      )
      setMode('running')
      poll(jobId, false)
    } catch (err) {
      if (typeof window !== 'undefined') sessionStorage.removeItem(`proxim-search-${candidateId}`)
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
      setMode('error')
    }
  }

  function handleCancel() {
    if (pollRef.current) clearTimeout(pollRef.current)
    pollRef.current = null
    if (typeof window !== 'undefined') sessionStorage.removeItem(`proxim-search-${candidateId}`)
    setMode('idle')
  }

  // ─── Derived values ───────────────────────────────────────────────────────

  const lastSearchAt = lastSearch?.lastSearchAt ?? null
  const relativeStr  = formatRelative(lastSearchAt)
  const absoluteStr  = formatAbsolute(lastSearchAt)
  const hours = lastSearchAt ? hoursAgo(lastSearchAt) : null
  const showCooldown = hours !== null && hours < 6
  const showStaleBadge = hours !== null && hours > 168
  const staleDays = hours !== null ? Math.round(hours / 24) : 0

  const lastRunFound = lastSearch?.jobsDiscovered ?? 0

  // ─── Border class by mode ─────────────────────────────────────────────────

  const borderClass =
    mode === 'running'
      ? 'border-primary'
      : mode === 'complete'
        ? 'border-success'
        : mode === 'error'
          ? 'border-red-700'
          : 'border-border-strong'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Card className={`bg-background ${borderClass} py-4 gap-3`}>
      {/* ── Header row ── */}
      <CardContent className="flex items-center justify-between pb-0">
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold tracking-widest text-primary uppercase">
            Job Search
          </span>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-foreground leading-tight">
              {lastSearchAt ? `Last searched ${relativeStr}` : 'No searches yet'}
            </span>
            {absoluteStr && (
              <span className="text-[10px] text-muted-foreground leading-tight">{absoluteStr}</span>
            )}
          </div>
          {showStaleBadge && (
            <Badge
              variant="outline"
              className="border-orange-500 text-orange-400 text-[9px] px-1.5 py-0 inline-flex items-center gap-1"
            >
              <AlertTriangle className="w-2.5 h-2.5" /> Stale · {staleDays}d
            </Badge>
          )}
        </div>
      </CardContent>

      {/* ── Body — switches by mode ── */}
      {mode === 'idle' && (
        <CardContent className="flex flex-col gap-3 pt-0">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Last run found" value={String(lastRunFound)} />
            <MiniStat label="Awaiting review" value={String(awaitingReview)} />
            <MiniStat label="Score failures" value={String(scoreFailed)} />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              className="flex-[2] text-[12px] h-8 gap-1.5"
              onClick={handleSearch}
            >
              <Search className="w-3.5 h-3.5" /> Search for New Jobs
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-[12px] h-8 border-border-strong text-foreground gap-1.5"
              onClick={onOpenBatchSheet}
            >
              <Zap className="w-3.5 h-3.5" /> Score Batch
            </Button>
          </div>

          {/* Cooldown note */}
          {showCooldown && (
            <p className="text-[10px] text-muted-foreground text-center">
              Searched {Math.round(hours!)}h ago · results may be similar
            </p>
          )}
        </CardContent>
      )}

      {mode === 'running' && (
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="grid grid-cols-3 gap-2">
            {steps.map((step, i) => (
              <StepBox key={i} step={step} />
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="text-[10px] text-muted-foreground hover:text-foreground h-auto p-0"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      )}

      {mode === 'complete' && completeResult && (
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="border border-success rounded-lg p-3 flex flex-col gap-2">
            <p className="text-[12px] font-semibold text-success inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Search complete</p>
            <div className="grid grid-cols-3 gap-2">
              <MiniStat
                label="New jobs"
                value={String(completeResult.newJobs)}
                valueClass="text-success"
              />
              <MiniStat label="Total found" value={String(completeResult.discovered)} />
              <MiniStat label="Duplicates skipped" value={String(completeResult.duplicatesSkipped)} />
            </div>
            <Button
              className="w-full text-[12px] h-8 mt-1"
              onClick={() => {
                onSearchComplete()
                router.push(`/candidates/${candidateId}/pipeline`)
              }}
            >
              Review {completeResult.newJobs} New Jobs in Scorecard <ArrowRight className="w-3.5 h-3.5" />
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              Auto-dismisses in {dismissTimer}s
            </p>
          </div>
        </CardContent>
      )}

      {mode === 'error' && (
        <CardContent className="flex flex-col gap-3 pt-0">
          <Alert className="border-destructive/40 bg-destructive/10 p-3 flex flex-col gap-2">
            <p className="text-[12px] text-destructive">{errorMsg}</p>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive text-[12px] h-8 self-start"
              onClick={() => setMode('idle')}
            >
              Try Again
            </Button>
          </Alert>
        </CardContent>
      )}
    </Card>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MiniStat({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="bg-card rounded-lg p-2 flex flex-col gap-0.5">
      <p className="text-[8px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-[15px] font-bold ${valueClass ?? 'text-foreground'}`}>{value}</p>
    </div>
  )
}

function StepBox({ step }: { step: StepState }) {
  const isActive = step.status === 'active'
  const isDone = step.status === 'done'
  const isPending = step.status === 'pending'

  const Icon = isDone ? Check : isActive ? Loader2 : Circle
  const borderColor = isDone
    ? 'border-success'
    : isActive
      ? 'border-primary'
      : 'border-border-strong'

  return (
    <div
      className={`border rounded-lg p-2 flex flex-col gap-0.5 ${borderColor} ${isPending ? 'opacity-50' : ''}`}
    >
      <p className="text-[11px] text-foreground inline-flex items-center gap-1">
        <Icon className={`w-3 h-3 ${isActive ? 'animate-spin' : ''}`} /> {step.label}
      </p>
      <p className="text-[9px] text-muted-foreground">
        {step.count ?? (isDone ? 'Done' : isActive ? 'Running…' : 'Waiting…')}
      </p>
    </div>
  )
}
