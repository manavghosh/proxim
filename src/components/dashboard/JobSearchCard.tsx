'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { triggerPipeline, getPipelineStatus } from '@/lib/api'
import type { LastSearch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JobSearchCardProps {
  candidateId: string
  lastSearch: LastSearch | null
  awaitingReview: number
  scoreFailed: number
  onSearchComplete: () => void
}

type Mode = 'idle' | 'running' | 'complete' | 'error'

interface StepState {
  status: 'pending' | 'active' | 'done'
  count: number | null
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

function formatTimestamp(lastSearchAt: string | null): string {
  if (!lastSearchAt) return 'No searches yet'
  const h = hoursAgo(lastSearchAt)
  if (h < 1) return `Last searched ${Math.round(h * 60)}m ago`
  if (h < 24) return `Last searched ${Math.round(h)}h ago`
  if (h < 48) return 'Last searched yesterday'
  return `Last searched ${Math.round(h / 24)} days ago`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobSearchCard({
  candidateId,
  lastSearch,
  awaitingReview,
  scoreFailed,
  onSearchComplete,
}: JobSearchCardProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [steps, setSteps] = useState<StepState[]>(INITIAL_STEPS)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null)
  const [dismissTimer, setDismissTimer] = useState<number>(8)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
          onSearchComplete()
          return 0
        }
        return t - 1
      })
    }, 1000)
    dismissRef.current = interval
    return () => clearInterval(interval)
  }, [mode, onSearchComplete])

  // ─── Polling ───────────────────────────────────────────────────────────────

  const poll = useCallback(
    (jobId: string, rescoreOnly: boolean) => {
      pollRef.current = setTimeout(async () => {
        try {
          const status = await getPipelineStatus(jobId)
          const stepIdx = JOB_TYPE_TO_STEP[status.jobType] ?? 0

          setSteps(
            STEP_LABELS.map((label, i) => {
              if (i < stepIdx) return { label, status: 'done', count: null }
              if (i === stepIdx) {
                return {
                  label,
                  status: 'active',
                  count: status.pipelineRun?.jobsDiscovered ?? null,
                }
              }
              return { label, status: 'pending', count: null }
            }),
          )

          if (status.followUpJobId) {
            // Follow the chain
            poll(status.followUpJobId, rescoreOnly)
            return
          }

          if (status.status === 'completed') {
            if (rescoreOnly) {
              setCompleteResult({ discovered: 0, newJobs: 0, duplicatesSkipped: 0 })
            } else {
              const discovered = status.pipelineRun?.jobsDiscovered ?? 0
              const deduped = status.pipelineRun?.jobsDeduplicated ?? 0
              // jobsDiscovered from pipeline_run = total found before dedup
              // newJobs = discovered - duplicatesSkipped (deduped count)
              setCompleteResult({
                discovered,
                newJobs: Math.max(0, discovered - deduped),
                duplicatesSkipped: deduped,
              })
            }
            setMode('complete')
            return
          }

          if (status.status === 'failed') {
            setErrorMsg('Pipeline run failed. Please try again.')
            setMode('error')
            return
          }

          // Still running — poll again
          poll(jobId, rescoreOnly)
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
          setMode('error')
        }
      }, 5000)
    },
    [],
  )

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handleSearch() {
    try {
      const { jobId } = await triggerPipeline('discovery_only', candidateId)
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
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
      setMode('error')
    }
  }

  async function handleRescore() {
    try {
      const { jobId } = await triggerPipeline('score_jobs', candidateId)
      setSteps(
        STEP_LABELS.map((label, i) => ({
          label,
          status: i === 2 ? 'active' : 'pending',
          count: null,
        })),
      )
      setMode('running')
      poll(jobId, true)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
      setMode('error')
    }
  }

  function handleCancel() {
    if (pollRef.current) clearTimeout(pollRef.current)
    pollRef.current = null
    setMode('idle')
  }

  // ─── Derived values ───────────────────────────────────────────────────────

  const lastSearchAt = lastSearch?.lastSearchAt ?? null
  const timestampStr = formatTimestamp(lastSearchAt)
  const hours = lastSearchAt ? hoursAgo(lastSearchAt) : null
  const showCooldown = hours !== null && hours < 6
  const showStaleBadge = hours !== null && hours > 168
  const staleDays = hours !== null ? Math.round(hours / 24) : 0

  const lastRunFound = lastSearch?.jobsDiscovered ?? 0

  // ─── Border class by mode ─────────────────────────────────────────────────

  const borderClass =
    mode === 'running'
      ? 'border-blue-600'
      : mode === 'complete'
        ? 'border-emerald-500'
        : mode === 'error'
          ? 'border-red-700'
          : 'border-[#1e3a5f]'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Card className={`bg-[#0a1628] ${borderClass} py-4 gap-3`}>
      {/* ── Header row ── */}
      <CardContent className="flex items-center justify-between pb-0">
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold tracking-widest text-blue-300 uppercase">
            Job Search
          </span>
          <span className="text-[13px] font-semibold text-slate-100">{timestampStr}</span>
          {showStaleBadge && (
            <Badge
              variant="outline"
              className="border-orange-500 text-orange-400 text-[9px] px-1.5 py-0"
            >
              ⚠ Stale · {staleDays}d
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
              className="flex-[2] text-[12px] h-8"
              onClick={handleSearch}
            >
              🔍 Search for New Jobs
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-[12px] h-8 border-[#1e3a5f] text-slate-300"
              onClick={handleRescore}
            >
              ↻ Re-score All
            </Button>
          </div>

          {/* Cooldown note */}
          {showCooldown && (
            <p className="text-[10px] text-slate-500 text-center">
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
            <button
              onClick={handleCancel}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </CardContent>
      )}

      {mode === 'complete' && completeResult && (
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="border border-emerald-500 rounded-lg p-3 flex flex-col gap-2">
            <p className="text-[12px] font-semibold text-emerald-400">✓ Search complete</p>
            <div className="grid grid-cols-3 gap-2">
              <MiniStat
                label="New jobs"
                value={String(completeResult.newJobs)}
                valueClass="text-emerald-400"
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
              Review {completeResult.newJobs} New Jobs in Pipeline →
            </Button>
            <p className="text-[10px] text-slate-500 text-center">
              Auto-dismisses in {dismissTimer}s
            </p>
          </div>
        </CardContent>
      )}

      {mode === 'error' && (
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="border border-red-700 rounded-lg p-3 flex flex-col gap-2">
            <p className="text-[12px] text-red-400">{errorMsg}</p>
            <Button
              variant="outline"
              className="border-red-700 text-red-400 text-[12px] h-8"
              onClick={() => setMode('idle')}
            >
              Try Again
            </Button>
          </div>
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
    <div className="bg-[#0d1f3c] rounded-lg p-2 flex flex-col gap-0.5">
      <p className="text-[8px] text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-[15px] font-bold ${valueClass ?? 'text-slate-100'}`}>{value}</p>
    </div>
  )
}

function StepBox({ step }: { step: StepState }) {
  const isActive = step.status === 'active'
  const isDone = step.status === 'done'
  const isPending = step.status === 'pending'

  const icon = isDone ? '✓' : isActive ? '⟳' : '◯'
  const borderColor = isDone
    ? 'border-emerald-500'
    : isActive
      ? 'border-blue-500'
      : 'border-[#1e3a5f]'

  return (
    <div
      className={`border rounded-lg p-2 flex flex-col gap-0.5 ${borderColor} ${isPending ? 'opacity-50' : ''}`}
    >
      <p className="text-[11px] text-slate-300">
        {icon} {step.label}
      </p>
      <p className="text-[9px] text-slate-500">
        {isDone
          ? step.count !== null
            ? `${step.count} found`
            : 'Done'
          : isActive
            ? step.count !== null
              ? `${step.count} found`
              : 'Running…'
            : 'Waiting…'}
      </p>
    </div>
  )
}
