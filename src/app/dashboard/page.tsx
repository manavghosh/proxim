'use client'

import { useEffect, useState } from 'react'
import { getCV, getReadiness } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { StatCard } from '@/components/dashboard/StatCard'
import { ReadinessRing } from '@/components/dashboard/ReadinessRing'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { ProfileCard } from '@/components/dashboard/ProfileCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
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

  useEffect(() => {
    Promise.all([getCV(), getReadiness()])
      .then(([cv, r]) => {
        setCandidate(cv)
        setReadiness(r)
      })
      .catch(() => setError('Failed to load dashboard data. Please refresh.'))
      .finally(() => setLoading(false))
  }, [])

  const cvMeta = parseStatusMeta(candidate)
  const pMeta = pipelineMeta(readiness)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar
        title="Dashboard"
        actions={
          <Button size="sm" className="text-xs">
            ▶ Run Pipeline
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
          </>
        )}
      </main>
    </div>
  )
}
