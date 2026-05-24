'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { getCV, getReadiness, getJobStats, resetFailedJobs, getReadyToScoreGroups, getLastSearch } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { StatCard } from '@/components/dashboard/StatCard'
import { ReadinessRing } from '@/components/dashboard/ReadinessRing'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { ProfileCard } from '@/components/dashboard/ProfileCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'
import { ScoringBatchSheet } from '@/components/dashboard/ScoringBatchSheet'
import { ImportJobsSheet } from '@/components/pipeline/ImportJobsSheet'
import { JobSearchCard } from '@/components/dashboard/JobSearchCard'
import type { CandidateState, PipelineReadiness } from '@/types/candidate'

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
  const [scoreFailed, setScoreFailed]     = useState(0)
  const [jobsMatched, setJobsMatched]     = useState<number | null>(null)
  const [applications, setApplications]   = useState<number | null>(null)
  const [rescoreLoading, setRescoreLoading] = useState(false)
  const [readyToScore, setReadyToScore]   = useState(0)
  const [batchSheetOpen, setBatchSheetOpen] = useState(false)
  const [importJobId, setImportJobId]       = useState<string | null>(null)
  const [lastSearch, setLastSearch]       = useState<import('@/lib/api').LastSearch | null>(null)
  const [awaitingReview, setAwaitingReview] = useState(0)

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
          const [cv, r, stats, ready, lastSearchData] = await Promise.all([
            getCV(candidateId),
            getReadiness(candidateId),
            getJobStats(candidateId),
            getReadyToScoreGroups(candidateId).catch(() => ({ totalJobs: 0, groups: [] })),
            getLastSearch(candidateId),
          ])
          setCandidate(cv)
          setReadiness(r)
          setScoreFailed(stats.scoreFailed)
          setJobsMatched(stats.jobsMatched)
          setApplications(stats.applications)
          setAwaitingReview(stats.awaitingReview)
          setReadyToScore(ready.totalJobs)
          setLastSearch(lastSearchData)
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

  const refreshStats = useCallback(async () => {
    try {
      const [stats, lastSearchData] = await Promise.all([
        getJobStats(candidateId),
        getLastSearch(candidateId),
      ])
      setScoreFailed(stats.scoreFailed)
      setJobsMatched(stats.jobsMatched)
      setApplications(stats.applications)
      setAwaitingReview(stats.awaitingReview)
      setLastSearch(lastSearchData)
    } catch {
      // silently ignore refresh errors
    }
  }, [candidateId])

  async function handleRescore() {
    setRescoreLoading(true)
    try {
      await resetFailedJobs(candidateId)
      setScoreFailed(0)
      setError(null)
    } catch {
      setError('Failed to reset failed jobs. Please try again.')
    } finally {
      setRescoreLoading(false)
    }
  }

  function handleBatchScored(pipelineJobId: string) {
    setImportJobId(pipelineJobId)
    void refreshReadyToScore()
    void refreshStats()
  }

  const cvMeta = parseStatusMeta(candidate)
  const pMeta  = pipelineMeta(readiness)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar
        title="Dashboard"
        actions={
          <div className="flex items-center gap-2">
            <CandidateSwitcher candidateId={candidateId} />
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
            <ImportJobsSheet
              candidateId={candidateId}
              label="+ Add Jobs"
              onImported={(pjId) => { if (pjId) setImportJobId(pjId) }}
            />
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
                sub={jobsMatched === null ? 'Loading…' : jobsMatched === 0 ? 'Start AI Agent to discover roles' : `${jobsMatched} evaluated role${jobsMatched !== 1 ? 's' : ''}`}
                dotColor={jobsMatched !== null && jobsMatched > 0 ? '#10b981' : undefined}
              />
              <StatCard
                label="Applications"
                value={applications === null ? '—' : String(applications)}
                sub={applications === null ? 'Loading…' : applications === 0 ? 'None approved yet' : `${applications} approved`}
                dotColor={applications !== null && applications > 0 ? '#06b6d4' : undefined}
              />
            </div>
            <JobSearchCard
              candidateId={candidateId}
              lastSearch={lastSearch}
              awaitingReview={awaitingReview}
              scoreFailed={scoreFailed}
              onSearchComplete={refreshStats}
            />
            <div className="grid grid-cols-[1fr_320px] gap-4">
              <div className="flex flex-col gap-4">
                {readiness && <ReadinessRing readiness={readiness} candidateId={candidateId} />}
                <ActivityFeed candidate={candidate} />
              </div>
              <ProfileCard candidate={candidate} candidateId={candidateId} />
            </div>
            <PipelineLogPane
              chainJobIds={importJobId ? [importJobId] : []}
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
