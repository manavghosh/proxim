'use client'

import { ExternalLink, BellOff, Bell, FileTextIcon, DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ScoredJob } from '@/lib/api'

const GRADE_STYLES: Record<string, { badge: string }> = {
  A: { badge: 'bg-emerald-500 text-white border-transparent' },
  B: { badge: 'bg-blue-500   text-white border-transparent' },
  C: { badge: 'bg-amber-500  text-white border-transparent' },
  D: { badge: 'bg-orange-500 text-white border-transparent' },
  F: { badge: 'bg-red-600    text-white border-transparent' },
}

interface Props {
  job: ScoredJob
  candidateId?: string
  onDecision: (jobId: string, decision: 'approved' | 'rejected' | 'snoozed' | 'scored') => void
  onViewReport: (jobId: string) => void
  onViewResume?: (jobId: string) => void
  isPending: boolean
}

export function JobCard({ job, candidateId, onDecision, onViewReport, onViewResume, isPending }: Props) {
  const score = (job.score10d as Record<string, unknown> | null)?.numeric_score as number | undefined
  const isSnoozed  = job.status === 'snoozed'
  const isApproved = job.status === 'approved'
  const isRejected = job.status === 'rejected'
  const gradeStyle = job.grade ? (GRADE_STYLES[job.grade] ?? GRADE_STYLES.F) : null

  return (
    <div className={`bg-[#0d1f3c] border rounded-xl p-4 flex flex-col gap-3 transition-opacity ${
      isSnoozed ? 'border-[#1e2d4a] opacity-60' : 'border-[#1e2d4a]'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {gradeStyle && job.grade && (
            <Badge className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold shrink-0 ${gradeStyle.badge}`}>
              {job.grade}
            </Badge>
          )}
          <div>
            <h3 className="text-[#e2e8f0] font-semibold text-sm leading-tight">{job.title}</h3>
            <p className="text-[#64748b] text-xs mt-0.5">{job.company}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          {score !== undefined && (
            <p className="text-[#94a3b8] text-xs font-mono">{score.toFixed(1)}</p>
          )}
          <p className="text-[#475569] text-[10px] capitalize">{job.source}</p>
          {isSnoozed && (
            <Badge variant="secondary" className="text-[10px] mt-1">Snoozed</Badge>
          )}
          {isApproved && (
            <Badge className="text-[10px] mt-1 bg-emerald-600 text-white border-transparent">Approved</Badge>
          )}
          {isRejected && (
            <Badge variant="destructive" className="text-[10px] mt-1">Rejected</Badge>
          )}
        </div>
      </div>

      {/* Pills */}
      {(job.location || job.archetype) && (
        <div className="flex gap-2 flex-wrap">
          {job.location && (
            <Badge variant="outline" className="text-[10px] text-[#475569] border-[#1e2d4a] bg-[#0d1829]">
              {job.location}
            </Badge>
          )}
          {job.archetype && (
            <Badge variant="outline" className="text-[10px] text-[#64748b] border-[#1e2d4a] bg-[#0d1829]">
              {job.archetype}
            </Badge>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <Button
          size="sm"
          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3"
          onClick={() => onDecision(job.id, 'approved')}
          disabled={isPending || isApproved}
          isLoading={isPending && !isSnoozed}
        >
          ✓ Approve
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-[#1e2d4a] text-[#94a3b8] hover:text-red-400 hover:border-red-400/30 px-3"
          onClick={() => onDecision(job.id, 'rejected')}
          disabled={isPending || isRejected}
        >
          ✕ Reject
        </Button>

        {/* Snooze toggle */}
        <Button
          size="sm"
          variant={isSnoozed ? 'default' : 'outline'}
          className={`h-7 text-xs px-3 gap-1 ${
            isSnoozed
              ? 'bg-amber-600 hover:bg-amber-700 text-white border-transparent'
              : 'border-[#1e2d4a] text-[#94a3b8] hover:text-amber-400 hover:border-amber-400/30'
          }`}
          onClick={() => onDecision(job.id, isSnoozed ? 'scored' : 'snoozed')}
          disabled={isPending}
        >
          {isSnoozed ? (
            <><Bell className="w-3 h-3" /> Unsnooze</>
          ) : (
            <><BellOff className="w-3 h-3" /> Snooze</>
          )}
        </Button>

        <div className="ml-auto flex gap-2 items-center flex-wrap justify-end">
          {/* Resume generation buttons */}
          {job.status === 'approved' && candidateId && (
            <Button size="sm" variant="outline"
              className="h-7 text-[10px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
              onClick={() => onViewResume?.(job.id)}>
              <FileTextIcon className="w-3 h-3" /> Generate Resume
            </Button>
          )}
          {['resume_ready', 'resume_failed', 'submitted'].includes(job.status) && (
            <Button size="sm" variant="outline"
              className={`h-7 text-[10px] gap-1 ${
                job.status === 'resume_failed'
                  ? 'border-red-700/40 text-red-400 hover:bg-red-950/30'
                  : 'border-[#1e2d4a] text-[#93c5fd]'
              }`}
              onClick={() => onViewResume?.(job.id)}>
              <DownloadIcon className="w-3 h-3" />
              {job.status === 'resume_failed' ? 'Resume Failed — Retry' : 'View Resume'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] text-[#475569] hover:text-[#94a3b8] px-2"
            onClick={() => onViewReport(job.id)}
          >
            Report ↗
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-[#475569] hover:text-[#94a3b8]"
            asChild
          >
            <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open job listing">
              <ExternalLink className="w-3 h-3" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}
