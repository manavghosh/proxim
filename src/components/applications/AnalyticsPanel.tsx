'use client'

import { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricCard } from './MetricCard'
import { GradeDistributionChart } from './GradeDistributionChart'
import { getAnalytics } from '@/lib/api'
import type { AnalyticsMetrics, TimeRange } from '@/types/candidate'

interface AnalyticsPanelProps {
  candidateId: string
  range: TimeRange
  onRangeChange: (range: TimeRange) => void
  refreshTrigger?: number
}

export function AnalyticsPanel({ candidateId, range, onRangeChange, refreshTrigger }: AnalyticsPanelProps) {
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getAnalytics(candidateId, range)
      setMetrics(result.metrics)
    } catch {
      setError('Failed to load analytics. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [candidateId, range])

  useEffect(() => { void fetchMetrics() }, [fetchMetrics, refreshTrigger])

  return (
    <div className="space-y-6">
      {/* Header + filter */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[#e2e8f0] font-semibold text-sm">Campaign Metrics</h2>
        <Select value={range} onValueChange={(v: string) => onRangeChange(v as TimeRange)}>
          <SelectTrigger className="w-32 h-8 text-xs bg-[#0d1f3c] border-[#1e2d4a] text-[#94a3b8]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#0d1f3c] border-[#1e2d4a]">
            <SelectItem value="7d" className="text-xs text-[#94a3b8]">Last 7 days</SelectItem>
            <SelectItem value="30d" className="text-xs text-[#94a3b8]">Last 30 days</SelectItem>
            <SelectItem value="90d" className="text-xs text-[#94a3b8]">Last 90 days</SelectItem>
            <SelectItem value="all" className="text-xs text-[#94a3b8]">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="px-4 py-3 bg-[#450a0a] border border-[#7f1d1d] rounded-lg text-[12px] text-[#fca5a5]">
          {error}
        </div>
      )}

      {/* In-progress notice */}
      {metrics && metrics.inProgressRuns > 0 && (
        <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/30">
          {metrics.inProgressRuns} run{metrics.inProgressRuns > 1 ? 's' : ''} in progress — excluded from metrics
        </Badge>
      )}

      {/* Metric cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl bg-[#0d1f3c]" />)}
        </div>
      ) : metrics ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricCard label="Jobs Discovered" value={metrics.totalJobsDiscovered} />
            <MetricCard label="A/B Grade Rate" value={metrics.abGradeRate} unit="%" />
            <MetricCard label="Email Open Rate" value={metrics.emailOpenRate} unit="%" />
            <MetricCard label="Email Reply Rate" value={metrics.emailReplyRate} unit="%" />
            <MetricCard label="LinkedIn Accept" value={metrics.linkedInAcceptRate} unit="%" />
            <MetricCard label="Interview Rate" value={metrics.interviewCallbackRate} unit="%" />
          </div>

          {/* Grade distribution chart */}
          <div>
            <p className="text-[11px] text-[#64748b] uppercase tracking-wide mb-3">Grade Distribution</p>
            <GradeDistributionChart distribution={metrics.gradeDistribution} />
          </div>

          {/* Run summary */}
          <p className="text-[11px] text-[#475569]">
            Based on {metrics.totalRuns} completed pipeline run{metrics.totalRuns !== 1 ? 's' : ''}
          </p>
        </>
      ) : null}
    </div>
  )
}
