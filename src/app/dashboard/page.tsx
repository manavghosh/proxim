'use client'

import { useEffect, useState } from 'react'
import { getCV, getReadiness, triggerPipeline, getPipelineStatus } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { StatCard } from '@/components/dashboard/StatCard'
import { ReadinessRing } from '@/components/dashboard/ReadinessRing'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { ProfileCard } from '@/components/dashboard/ProfileCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'
import type { CandidateState, PipelineReadiness } from '@/types/candidate'

function parseStatusMeta(candidate: CandidateState | null): {
  value: string
  sub: string
  dot?: string
} {
  if (!candidate) return { value: '—', sub: 'Loading…' }
  const s = candidate.parseStatus
  if (s === 'ready') return { value: 'Ready', sub: 'Profile extracted', dot: '#10b981' }
  if (s === 'parsing') return { value: 'Parsing…', sub: 'In progress', dot: '#f59e0b' }
  if (s === 'failed') return { value: 'Failed', sub: 'Re-upload CV', dot: '#ef4444' }
  return { value: 'Pending', sub: 'No CV yet', dot: '#475569' }
}

function pipelineMeta(readiness: PipelineReadiness | null): {
  value: string
  sub: string
  dot?: string
} {
  if (!readiness) return { value: '—', sub: 'Loading…' }
  if (readiness.ready) return { value: 'Ready', sub: 'All criteria met', dot: '#10b981' }
  const n = readiness.missing.length
  return { value: 'Not ready', sub: `${n} item${n > 1 ? 's' : ''} missing`, dot: '#f59e0b' }
}

export default function DashboardPage() {
  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chainJobIds, setChainJobIds] = useState<string[]>([])
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(false)

  useEffect(() => {
    async function load() {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const [cv, r] = await Promise.all([getCV(), getReadiness()])
          setCandidate(cv)
          setReadiness(r)
          setLoading(false)
          return
        } catch {
          if (attempt < 3) {
            await new Promise((res) => setTimeout(res, 1500 * attempt))
          } else {
            setError('Failed to load dashboard data. Please refresh.')
            setLoading(false)
          }
        }
      }
    }
    load()
  }, [])

  async function handleRunPipeline() {
    setPipelineLoading(true)
    setPipelineStatus(null)
    setError(null)
    try {
      const { jobId } = await triggerPipeline('discovery_only')
      setChainJobIds([jobId])   // fresh chain — clears previous run's logs
      setPipelineStatus('queued')

      // Poll for status, chaining to any auto-queued follow-up jobs.
      // When a followUpJobId is detected, we APPEND it to the chain so the
      // log pane accumulates logs across all phases without clearing.
      const poll = async (currentJobId: string) => {
        try {
          const status = await getPipelineStatus(currentJobId)
          setPipelineStatus(status.status)

          if (status.followUpJobId) {
            // Append follow-up job to the chain — log pane will NOT clear
            setChainJobIds((prev) => [...prev, status.followUpJobId!])
            setPipelineStatus('running')
            setTimeout(() => { void poll(status.followUpJobId!) }, 3000)
          } else if (status.status !== 'completed' && status.status !== 'failed') {
            setTimeout(() => { void poll(currentJobId) }, 5000)
          } else {
            setPipelineLoading(false)
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

  const cvMeta = parseStatusMeta(candidate)
  const pMeta = pipelineMeta(readiness)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar
        title="Dashboard"
        actions={
          <Button size="sm" className="text-xs" onClick={handleRunPipeline} isLoading={pipelineLoading}>
            {pipelineStatus ? `Pipeline: ${pipelineStatus}` : '▶ Run Pipeline'}
          </Button>
        }
      />

      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 bg-[#450a0a] border border-[#7f1d1d] rounded-lg text-[12px] text-[#fca5a5]">
            {error}
          </div>
        )}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-xl bg-[#0d1f3c]" />
              ))}
            </div>
            <Skeleton className="h-[200px] rounded-xl bg-[#0d1f3c]" />
          </div>
        ) : (
          <>
            {/* Stat row */}
            <div className="grid grid-cols-4 gap-4 mb-5">
              <StatCard
                label="Pipeline Status"
                value={pMeta.value}
                sub={pMeta.sub}
                dotColor={pMeta.dot}
              />
              <StatCard
                label="CV Parse"
                value={cvMeta.value}
                sub={cvMeta.sub}
                dotColor={cvMeta.dot}
              />
              <StatCard
                label="Jobs Matched"
                value="—"
                sub="Pipeline not active"
              />
              <StatCard
                label="Applications"
                value="—"
                sub="None sent yet"
              />
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-[1fr_320px] gap-4">
              <div className="flex flex-col gap-4">
                {readiness && <ReadinessRing readiness={readiness} />}
                <ActivityFeed candidate={candidate} />
              </div>
              <ProfileCard candidate={candidate} />
            </div>
            <PipelineLogPane chainJobIds={chainJobIds} />
          </>
        )}
      </main>
    </div>
  )
}
