'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, XCircle, Bell, BellOff, MapPin, Building2, ExternalLink, Calendar } from 'lucide-react'
import { StrengthRiskChips } from './StrengthRiskChips'
import { ScoreReportPane } from './ScoreReportPane'
import type { HitlJob } from '@/lib/api'

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-emerald-950/60 text-emerald-400 border-emerald-700',
  B: 'bg-blue-950/60 text-blue-400 border-blue-700',
  C: 'bg-amber-950/60 text-amber-400 border-amber-700',
  D: 'bg-orange-950/60 text-orange-400 border-orange-700',
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

interface JobReviewCardProps {
  job: HitlJob
  candidateId: string
  onApprove: (jobId: string) => void
  onReject: (jobId: string) => void
  onSnooze: (jobId: string) => void
  onUnsnooze: (jobId: string) => void
  isPending: boolean
}

export function JobReviewCard({
  job,
  candidateId: _candidateId,
  onApprove,
  onReject,
  onSnooze,
  onUnsnooze,
  isPending,
}: JobReviewCardProps) {
  const [reportOpen, setReportOpen] = useState(false)

  const gradeStyle = job.grade ? GRADE_STYLES[job.grade] ?? GRADE_STYLES.D : ''
  const isSnoozed = job.status === 'snoozed'
  const isApproved = job.status === 'approved' || job.status === 'resume_ready' || job.status === 'submitted'
  const snoozedUntil = job.hitlCheckpoint?.snoozedUntil

  return (
    <Card className="bg-[#060d1f] border border-[#1e2d4a] hover:border-[#2d4a6e] transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Grade + Score row */}
            <div className="flex items-center gap-2 mb-1.5">
              {job.grade && (
                <Badge
                  variant="outline"
                  className={`text-[11px] font-bold px-2 py-0.5 ${gradeStyle}`}
                  data-testid="grade-badge"
                >
                  {job.grade}
                </Badge>
              )}
              {job.numericScore !== null && (
                <span className="text-[12px] font-semibold text-[#93c5fd]">
                  {job.numericScore.toFixed(1)} / 5.0
                </span>
              )}
              {isSnoozed && snoozedUntil && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-amber-700 text-amber-400 bg-amber-950/40"
                >
                  Snoozed until {formatDate(snoozedUntil as unknown as string)}
                </Badge>
              )}
              {isApproved && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-emerald-700 text-emerald-400 bg-emerald-950/40"
                >
                  Approved
                </Badge>
              )}
            </div>

            {/* Title + Company */}
            <h3 className="text-[13px] font-semibold text-[#f1f5f9] leading-snug truncate">
              {job.title}
            </h3>
            <div className="flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1 text-[11px] text-[#64748b]">
                <Building2 className="w-3 h-3" />
                {job.company}
              </span>
              {job.location && (
                <span className="flex items-center gap-1 text-[11px] text-[#64748b]">
                  <MapPin className="w-3 h-3" />
                  {job.location}
                </span>
              )}
              {job.postedAt && (
                <span className="flex items-center gap-1 text-[11px] text-[#64748b]">
                  <Calendar className="w-3 h-3" />
                  {formatDate(job.postedAt)}
                </span>
              )}
            </div>

            {/* Strength/Risk chips */}
            <StrengthRiskChips score10d={job.score10d as Record<string, unknown> | null} />

            {/* Score report */}
            <ScoreReportPane
              reportMd={job.reportMd}
              isOpen={reportOpen}
              onToggle={() => setReportOpen(p => !p)}
            />
          </div>

          {/* Source link */}
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-[#475569] hover:text-[#93c5fd] transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Action buttons */}
        {!isApproved && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#0d1829]">
            <Button
              size="sm"
              className="h-7 text-[11px] px-3 bg-emerald-900 hover:bg-emerald-800 text-emerald-300 border border-emerald-700"
              onClick={() => onApprove(job.id)}
              disabled={isPending}
              data-testid="approve-btn"
            >
              <CheckCircle className="w-3 h-3 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] px-3 border-red-800 text-red-400 hover:bg-red-950/40"
              onClick={() => onReject(job.id)}
              disabled={isPending}
              data-testid="reject-btn"
            >
              <XCircle className="w-3 h-3 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 text-[11px] px-3 ml-auto ${
                isSnoozed
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-[#64748b] hover:text-[#94a3b8]'
              }`}
              onClick={() => (isSnoozed ? onUnsnooze(job.id) : onSnooze(job.id))}
              disabled={isPending}
              data-testid="snooze-btn"
            >
              {isSnoozed ? (
                <><BellOff className="w-3 h-3 mr-1" />Unsnooze</>
              ) : (
                <><Bell className="w-3 h-3 mr-1" />Snooze 7d</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
