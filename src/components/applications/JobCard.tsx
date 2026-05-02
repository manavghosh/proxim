'use client'

import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScoredJob } from '@/lib/api'

const GRADE_COLOURS: Record<string, string> = {
  A: 'bg-emerald-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-amber-500 text-white',
  D: 'bg-orange-500 text-white',
}

function GradeBadge({ grade }: { grade: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold shrink-0 ${
        GRADE_COLOURS[grade] ?? 'bg-[#1e2d4a] text-[#94a3b8]'
      }`}
    >
      {grade}
    </span>
  )
}

interface Props {
  job: ScoredJob
  onDecision: (jobId: string, decision: 'approved' | 'rejected' | 'snoozed') => void
  onViewReport: (jobId: string) => void
  isPending: boolean
}

export function JobCard({ job, onDecision, onViewReport, isPending }: Props) {
  const score = (job.score10d as Record<string, unknown> | null)?.numeric_score as number | undefined

  return (
    <div className="bg-[#0d1f3c] border border-[#1e2d4a] rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {job.grade && <GradeBadge grade={job.grade} />}
          <div>
            <h3 className="text-[#e2e8f0] font-semibold text-sm leading-tight">{job.title}</h3>
            <p className="text-[#64748b] text-xs mt-0.5">{job.company}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          {score && (
            <p className="text-[#94a3b8] text-xs font-mono">
              {typeof score === 'number' ? score.toFixed(1) : score}
            </p>
          )}
          <p className="text-[#475569] text-[10px] capitalize">{job.source}</p>
        </div>
      </div>

      {/* Pills */}
      {(job.location || job.archetype) && (
        <div className="flex gap-2 flex-wrap">
          {job.location && (
            <span className="text-[10px] text-[#475569] bg-[#0d1829] px-2 py-0.5 rounded">
              {job.location}
            </span>
          )}
          {job.archetype && (
            <span className="text-[10px] text-[#64748b] bg-[#0d1829] px-2 py-0.5 rounded">
              {job.archetype}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3"
          onClick={() => onDecision(job.id, 'approved')}
          disabled={isPending || job.status === 'approved'}
          isLoading={isPending}
          aria-label="Approve"
        >
          ✓ Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-[#1e2d4a] text-[#94a3b8] hover:text-red-400 px-3"
          onClick={() => onDecision(job.id, 'rejected')}
          disabled={isPending || job.status === 'rejected'}
          aria-label="Reject"
        >
          ✕ Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-[#1e2d4a] text-[#94a3b8] px-3"
          onClick={() => onDecision(job.id, 'snoozed')}
          disabled={isPending || job.status === 'snoozed'}
          aria-label="Snooze"
        >
          ⏸ Snooze
        </Button>
        <div className="ml-auto flex gap-2 items-center">
          <button
            onClick={() => onViewReport(job.id)}
            className="text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            Report ↗
          </button>
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  )
}
