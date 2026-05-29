'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { getCV, getReadiness, getJobStats, resetFailedJobs, getReadyToScoreGroups, getLastSearch, cancelPipelineJob, getInsights } from '@/lib/api'
import { Zap, AlertTriangle } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { StatCard } from '@/components/dashboard/StatCard'
import { ReadinessRing } from '@/components/dashboard/ReadinessRing'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { ProfileCard } from '@/components/dashboard/ProfileCard'
import { DashboardSection } from '@/components/dashboard/DashboardSection'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'
import { ScoringBatchSheet } from '@/components/dashboard/ScoringBatchSheet'
import { ImportJobsSheet } from '@/components/pipeline/ImportJobsSheet'
import { JobSearchCard } from '@/components/dashboard/JobSearchCard'
import { InsightsFunnelCard } from '@/components/dashboard/InsightsFunnelCard'
import type { CandidateState, PipelineReadiness, InsightsResponse } from '@/types/candidate'

function parseStatusMeta(candidate: CandidateState | null) {
  if (!candidate) return { value: '—', sub: 'Loading…' }
  const s = candidate.parseStatus
  if (s === 'ready')   return { value: 'Ready',    sub: 'Profile extracted',  dot: 'hsl(var(--success))' }
  if (s === 'parsing') return { value: 'Parsing…', sub: 'In progress',        dot: 'hsl(var(--warning))' }
  if (s === 'failed')  return { value: 'Failed',   sub: 'Re-upload CV',       dot: 'hsl(var(--destructive))' }
  return { value: 'Pending', sub: 'No CV yet', dot: 'hsl(var(--muted-foreground))' }
}

function pipelineMeta(readiness: PipelineReadiness | null) {
  if (!readiness) return { value: '—', sub: 'Loading…' }
  if (readiness.ready) return { value: 'Ready', sub: 'All criteria met', dot: 'hsl(var(--success))' }
  const n = readiness.missing.length
  return { value: 'Not ready', sub: `${n} item${n > 1 ? 's' : ''} missing`, dot: 'hsl(var(--warning))' }
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
  const [batchAutoSelectAll, setBatchAutoSelectAll] = useState(false)
  const [importJobId, setImportJobId]       = useState<string | null>(null)
  const [isCancelling, setIsCancelling]         = useState(false)
  const [awaitingCancelledStop, setAwaitingCancelledStop] = useState(false)
  const [lastSearch, setLastSearch]       = useState<import('@/lib/api').LastSearch | null>(null)
  const [awaitingReview, setAwaitingReview] = useState(0)
  const [insights, setInsights] = useState<InsightsResponse | null>(null)

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
          const [cv, r, stats, ready, lastSearchData, insightsRes] = await Promise.all([
            getCV(candidateId),
            getReadiness(candidateId),
            getJobStats(candidateId),
            getReadyToScoreGroups(candidateId).catch(() => ({ totalJobs: 0, groups: [] })),
            getLastSearch(candidateId),
            getInsights(candidateId),
          ])
          setCandidate(cv)
          setReadiness(r)
          setScoreFailed(stats.scoreFailed)
          setJobsMatched(stats.jobsMatched)
          setApplications(stats.applications)
          setAwaitingReview(stats.awaitingReview)
          setReadyToScore(ready.totalJobs)
          setLastSearch(lastSearchData)
          setInsights(insightsRes)
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

  async function handleCancelScoring() {
    if (!importJobId || isCancelling) return
    setIsCancelling(true)
    setAwaitingCancelledStop(true)
    try {
      await cancelPipelineJob(importJobId)
    } catch {
      setAwaitingCancelledStop(false)
    } finally {
      setIsCancelling(false)
    }
  }

  function handlePipelineStopped() {
    if (!awaitingCancelledStop) return
    setAwaitingCancelledStop(false)
    setImportJobId(null)
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
                className="text-xs border-info/40 text-info hover:bg-info/10 gap-1.5"
                onClick={() => { setBatchAutoSelectAll(false); setBatchSheetOpen(true) }}
              >
                <Zap className="w-3.5 h-3.5" /> Score Batch ({readyToScore})
              </Button>
            )}
            {scoreFailed > 0 && (
              <Button size="sm" variant="outline"
                className="text-xs border-warning/40 text-warning hover:bg-warning/10 gap-1.5"
                onClick={handleRescore} isLoading={rescoreLoading}>
                <AlertTriangle className="w-3.5 h-3.5" /> Rescore Failed ({scoreFailed})
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
      {/*
        Split-pane layout.
        <main> is the flex row — no intermediate wrapper div.
        min-h-0 lets a flex-1 item honour overflow on its children.
        Left column scrolls independently; right sidebar is a separate flex
        sibling so it never participates in the left column's reflow.
      */}
      <main className="flex-1 min-h-0 bg-muted flex flex-row gap-6 p-6 overflow-hidden">
        {/* Left — scrolls vertically; scrollbar hidden so opening sections doesn't cause visual jump */}
        <div className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto pb-6 space-y-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {error && (
            <div className="px-4 py-3 bg-destructive/10 border border-destructive/40 rounded-lg text-[12px] text-destructive">{error}</div>
          )}

          {loading ? (
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[88px] rounded-xl bg-card" />)}
              </div>
              <Skeleton className="h-[200px] rounded-xl bg-card" />
            </div>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard label="Pipeline Status" value={pMeta.value} sub={pMeta.sub} dotColor={pMeta.dot} />
                <StatCard label="CV Parse" value={cvMeta.value} sub={cvMeta.sub} dotColor={cvMeta.dot} />
                <StatCard
                  label="Jobs Matched"
                  value={jobsMatched === null ? '—' : String(jobsMatched)}
                  sub={jobsMatched === null ? 'Loading…' : jobsMatched === 0 ? 'Start AI Agent to discover roles' : `${jobsMatched} evaluated role${jobsMatched !== 1 ? 's' : ''}`}
                  dotColor={jobsMatched !== null && jobsMatched > 0 ? 'hsl(var(--success))' : undefined}
                />
                <StatCard
                  label="Applications"
                  value={applications === null ? '—' : String(applications)}
                  sub={applications === null ? 'Loading…' : applications === 0 ? 'None approved yet' : `${applications} approved`}
                  dotColor={applications !== null && applications > 0 ? 'hsl(var(--info))' : undefined}
                />
              </div>

              {/* Job search */}
              <JobSearchCard
                candidateId={candidateId}
                lastSearch={lastSearch}
                awaitingReview={awaitingReview}
                scoreFailed={scoreFailed}
                onSearchComplete={refreshStats}
                onOpenBatchSheet={() => { setBatchAutoSelectAll(true); setBatchSheetOpen(true) }}
              />

              {/* Outreach insights */}
              <DashboardSection title="Outreach Insights" storageKey="insights">
                <InsightsFunnelCard insights={insights} />
              </DashboardSection>

              {/* Pipeline readiness */}
              <DashboardSection title="Pipeline Readiness" storageKey="readiness">
                {readiness && <ReadinessRing readiness={readiness} candidateId={candidateId} />}
              </DashboardSection>

              {/* Recent activity */}
              <DashboardSection title="Recent Activity" defaultOpen={false} storageKey="activity">
                <ActivityFeed candidate={candidate} />
              </DashboardSection>

              {/* Pipeline log — only when a job is active */}
              {importJobId && (
                <DashboardSection title="Pipeline Log" storageKey="log">
                  <PipelineLogPane
                    chainJobIds={[importJobId]}
                    onReviewRequired={() => setBatchSheetOpen(true)}
                    onCancelRunning={handleCancelScoring}
                    cancellingRunning={isCancelling}
                    awaitingCancelStop={awaitingCancelledStop}
                    onStopped={handlePipelineStopped}
                  />
                </DashboardSection>
              )}
            </>
          )}
        </div>

        {/* Right — pinned; separate flex sibling, never scrolls with left column */}
        <aside className="w-[260px] shrink-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!loading && <ProfileCard candidate={candidate} candidateId={candidateId} />}
        </aside>
      </main>
      <ScoringBatchSheet
        open={batchSheetOpen}
        onOpenChange={setBatchSheetOpen}
        candidateId={candidateId}
        onScored={handleBatchScored}
        autoSelectAll={batchAutoSelectAll}
      />
    </div>
  )
}
