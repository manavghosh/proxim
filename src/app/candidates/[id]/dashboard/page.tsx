'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { getCV, getReadiness, triggerPipeline, getPipelineStatus, getJobStats, resetFailedJobs, getReadyToScoreGroups } from '@/lib/api'
import type { PipelineJobType } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { StatCard } from '@/components/dashboard/StatCard'
import { ReadinessRing } from '@/components/dashboard/ReadinessRing'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { ProfileCard } from '@/components/dashboard/ProfileCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'
import { ScoringBatchSheet } from '@/components/dashboard/ScoringBatchSheet'
import type { CandidateState, PipelineReadiness } from '@/types/candidate'

const PHASE_OPTIONS: Array<{ value: PipelineJobType; label: string; description: string }> = [
  { value: 'discovery_only', label: '▶ Full Pipeline',   description: 'Discover → Fetch JDs → Score' },
  { value: 'fetch_jds',      label: '📄 Fetch JDs',      description: 'Fetch JD text for discovered jobs' },
  { value: 'score_jobs',     label: '🏅 Score Jobs',     description: 'Score & grade all fetched JDs' },
]

function parseStatusMeta(candidate: CandidateState | null) {
  if (!candidate) return { value: '—', sub: 'Loading…' }
  const s = candidate.parseStatus
  if (s === 'ready')   return { value: 'Ready',    sub: 'Profile extracted',  dot: '#10b981' }
  if (s === 'parsing') return { value: 'Parsing…', sub: 'In progress',        dot: '#f59e0b' }
  if (s === 'failed')  return { value: 'Failed',   sub: 'Re-upload CV',       dot: '#ef4444' }
  return { value: 'Pending', sub: 'No CV yet', dot: '#475569' }
}

function pipelineMeta(readiness: PipelineReadiness | null) {
  if (!readiness) return { value: '—', sub: 'Loading…' }
  if (readiness.ready) return { value: 'Ready', sub: 'All criteria met', dot: '#10b981' }
  const n = readiness.missing.length
  return { value: 'Not ready', sub: `${n} item${n > 1 ? 's' : ''} missing`, dot: '#f59e0b' }
}

export default function DashboardPage() {
  const { id: candidateId } = useParams<{ id: string }>()

  const [candidate, setCandidate]         = useState<CandidateState | null>(null)
  const [readiness, setReadiness]         = useState<PipelineReadiness | null>(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [chainJobIds, setChainJobIds]     = useState<string[]>([])
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(false)
  const [selectedPhase, setSelectedPhase] = useState<PipelineJobType>('discovery_only')
  const [showPhaseMenu, setShowPhaseMenu] = useState(false)
  const phaseMenuRef = useRef<HTMLDivElement>(null)
  const [scoreFailed, setScoreFailed]     = useState(0)
  const [jobsMatched, setJobsMatched]     = useState<number | null>(null)
  const [applications, setApplications]   = useState<number | null>(null)
  const [rescoreLoading, setRescoreLoading] = useState(false)
  const [readyToScore, setReadyToScore]   = useState(0)
  const [batchSheetOpen, setBatchSheetOpen] = useState(false)

  const refreshReadyToScore = useCallback(async () => {
    try {
      const res = await getReadyToScoreGroups(candidateId)
      setReadyToScore(res.totalJobs)
    } catch {
      setReadyToScore(0)
    }
  }, [candidateId])

  useEffect(() => {
    async function load() {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const [cv, r, stats, ready] = await Promise.all([
            getCV(candidateId),
            getReadiness(candidateId),
            getJobStats(candidateId),
            getReadyToScoreGroups(candidateId).catch(() => ({ totalJobs: 0, groups: [] })),
          ])
          setCandidate(cv)
          setReadiness(r)
          setScoreFailed(stats.scoreFailed)
          setJobsMatched(stats.jobsMatched)
          setApplications(stats.applications)
          setReadyToScore(ready.totalJobs)
          setLoading(false)
          return
        } catch {
          if (attempt < 3) await new Promise((res) => setTimeout(res, 1500 * attempt))
          else { setError('Failed to load dashboard data. Please refresh.'); setLoading(false) }
        }
      }
    }
    load()
  }, [candidateId])

  async function startPipeline(phase: PipelineJobType) {
    setPipelineLoading(true)
    setPipelineStatus(null)
    setError(null)
    try {
      const { jobId } = await triggerPipeline(phase, candidateId)
      setChainJobIds([jobId])
      setPipelineStatus('queued')

      const poll = async (currentJobId: string) => {
        try {
          const status = await getPipelineStatus(currentJobId)
          setPipelineStatus(status.status)
          if (status.followUpJobId) {
            setChainJobIds((prev) => [...prev, status.followUpJobId!])
            setPipelineStatus('running')
            setTimeout(() => { void poll(status.followUpJobId!) }, 3000)
          } else if (status.status !== 'completed' && status.status !== 'failed') {
            setTimeout(() => { void poll(currentJobId) }, 5000)
          } else {
            setPipelineLoading(false)
            // After any phase finishes, refresh ready-to-score count and job stats so
            // the user sees the new "ready to score" chip without a manual reload.
            void refreshReadyToScore()
            void getJobStats(candidateId).then((s) => {
              setScoreFailed(s.scoreFailed)
              setJobsMatched(s.jobsMatched)
              setApplications(s.applications)
            }).catch(() => {})
          }
        } catch {
          setTimeout(() => { void poll(currentJobId) }, 5000)
        }
      }
      void poll(jobId)
    } catch (e) {
      setPipelineLoading(false)
      setError(e instanceof Error ? e.message : 'Failed to start pipeline. Check the daemon is running.')
    }
  }

  async function handleRescore() {
    setRescoreLoading(true)
    try {
      const { reset } = await resetFailedJobs(candidateId)
      setScoreFailed(0)
      setError(null)
      if (reset > 0) await startPipeline('score_jobs')
    } catch {
      setError('Failed to reset failed jobs. Please try again.')
    } finally {
      setRescoreLoading(false)
    }
  }

  function handleBatchScored(pipelineJobId: string) {
    setChainJobIds([pipelineJobId])
    setPipelineStatus('queued')
    setPipelineLoading(true)
    void refreshReadyToScore()
    const poll = async () => {
      try {
        const status = await getPipelineStatus(pipelineJobId)
        setPipelineStatus(status.status)
        if (status.status === 'completed' || status.status === 'failed') {
          setPipelineLoading(false)
          void refreshReadyToScore()
          void getJobStats(candidateId).then((s) => {
            setScoreFailed(s.scoreFailed)
            setJobsMatched(s.jobsMatched)
            setApplications(s.applications)
          }).catch(() => {})
        } else {
          setTimeout(() => { void poll() }, 5000)
        }
      } catch {
        setTimeout(() => { void poll() }, 5000)
      }
    }
    void poll()
  }

  const cvMeta = parseStatusMeta(candidate)
  const pMeta  = pipelineMeta(readiness)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar
        title="Dashboard"
        actions={
          <div className="flex items-center gap-2">
            {readyToScore > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                onClick={() => setBatchSheetOpen(true)}
              >
                ⚡ Score Batch ({readyToScore})
              </Button>
            )}
            {scoreFailed > 0 && (
              <Button size="sm" variant="outline"
                className="text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                onClick={handleRescore} isLoading={rescoreLoading}>
                ⚠ Rescore Failed ({scoreFailed})
              </Button>
            )}
            <div className="relative flex items-center gap-0" ref={phaseMenuRef}>
              <Button size="sm" className="text-xs rounded-r-none border-r border-r-white/20"
                onClick={() => startPipeline(selectedPhase)} isLoading={pipelineLoading}>
                {pipelineStatus ? `Pipeline: ${pipelineStatus}` : PHASE_OPTIONS.find(p => p.value === selectedPhase)?.label ?? '▶ Run Pipeline'}
              </Button>
              {!pipelineLoading && (
                <Button
                  size="sm"
                  onClick={() => setShowPhaseMenu(v => !v)}
                  className="h-8 px-2 rounded-l-none rounded-r-sm border-l border-l-white/20 text-xs"
                  title="Select pipeline phase"
                >▾</Button>
              )}
              {showPhaseMenu && (
                <div className="absolute top-full right-0 mt-1 w-64 bg-[#0d1f3c] border border-[#1e2d4a] rounded-lg shadow-xl z-50 overflow-hidden">
                  {PHASE_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      variant="ghost"
                      className={`w-full justify-start px-4 py-3 h-auto text-xs rounded-none ${selectedPhase === opt.value ? 'bg-[#1e3a5f] text-[#e2e8f0]' : 'text-[#94a3b8]'}`}
                      onClick={() => { setSelectedPhase(opt.value); setShowPhaseMenu(false) }}
                    >
                      <div className="text-left">
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-[#475569] text-[10px] mt-0.5">{opt.description}</div>
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        }
      />
      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 bg-[#450a0a] border border-[#7f1d1d] rounded-lg text-[12px] text-[#fca5a5]">{error}</div>
        )}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[88px] rounded-xl bg-[#0d1f3c]" />)}
            </div>
            <Skeleton className="h-[200px] rounded-xl bg-[#0d1f3c]" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4 mb-5">
              <StatCard label="Pipeline Status" value={pMeta.value} sub={pMeta.sub} dotColor={pMeta.dot} />
              <StatCard label="CV Parse" value={cvMeta.value} sub={cvMeta.sub} dotColor={cvMeta.dot} />
              <StatCard
                label="Jobs Matched"
                value={jobsMatched === null ? '—' : String(jobsMatched)}
                sub={jobsMatched === null ? 'Loading…' : jobsMatched === 0 ? 'Run pipeline to discover jobs' : `${jobsMatched} scored job${jobsMatched !== 1 ? 's' : ''}`}
                dotColor={jobsMatched !== null && jobsMatched > 0 ? '#10b981' : undefined}
              />
              <StatCard
                label="Applications"
                value={applications === null ? '—' : String(applications)}
                sub={applications === null ? 'Loading…' : applications === 0 ? 'None approved yet' : `${applications} approved`}
                dotColor={applications !== null && applications > 0 ? '#06b6d4' : undefined}
              />
            </div>
            <div className="grid grid-cols-[1fr_320px] gap-4">
              <div className="flex flex-col gap-4">
                {readiness && <ReadinessRing readiness={readiness} candidateId={candidateId} />}
                <ActivityFeed candidate={candidate} />
              </div>
              <ProfileCard candidate={candidate} candidateId={candidateId} />
            </div>
            <PipelineLogPane
              chainJobIds={chainJobIds}
              onReviewRequired={() => setBatchSheetOpen(true)}
            />
          </>
        )}
      </main>
      <ScoringBatchSheet
        open={batchSheetOpen}
        onOpenChange={setBatchSheetOpen}
        candidateId={candidateId}
        onScored={handleBatchScored}
      />
    </div>
  )
}
