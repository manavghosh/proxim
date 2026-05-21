'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, XCircle, Bell, BellOff, MapPin, Building2, ExternalLink, Calendar, AlertTriangle, FileTextIcon } from 'lucide-react'
import { StrengthRiskChips } from './StrengthRiskChips'
import { ScoreReportPane } from './ScoreReportPane'
import type { HitlJob } from '@/lib/api'
import type { OutreachTargetSummary, EmailCadenceSummary } from '@/types/candidate'
import { OutreachStatusBadge } from './OutreachStatusBadge'
import { EmailCadenceStatusBadge } from './EmailCadenceStatusBadge'
import { EmailNotFoundPanel } from './EmailNotFoundPanel'

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-emerald-950/60 text-emerald-400 border-emerald-700',
  B: 'bg-blue-950/60 text-blue-400 border-blue-700',
  C: 'bg-amber-950/60 text-amber-400 border-amber-700',
  D: 'bg-orange-950/60 text-orange-400 border-orange-700',
  E: 'bg-rose-950/60 text-rose-400 border-rose-700',
}

const EXPIRY_WARNING_DAYS = 30   // threshold for "Likely expired" badge
const AGE_AMBER_DAYS      = 14   // start showing amber colour for "ageing" posts

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

function getDayAge(iso: string | null | undefined): number | null {
  if (!iso) return null
  try {
    const ms = Date.now() - new Date(iso).getTime()
    return Math.floor(ms / (1000 * 60 * 60 * 24))
  } catch {
    return null
  }
}

function formatRelativeAge(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 7)  return `${days} days ago`
  if (days < 14) return `${Math.floor(days / 7)} week ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}

interface JobReviewCardProps {
  job: HitlJob
  candidateId: string
  onApprove: (jobId: string) => void
  onReject: (jobId: string) => void
  onSnooze: (jobId: string) => void
  onUnsnooze: (jobId: string) => void
  onGenerateResume: (jobId: string) => void
  isPending: boolean
  outreachTarget?: OutreachTargetSummary | null
  emailCadence?: EmailCadenceSummary | null
  onUpdate: () => void
}

export function JobReviewCard({
  job,
  candidateId: _candidateId,
  onApprove,
  onReject,
  onSnooze,
  onUnsnooze,
  onGenerateResume,
  isPending,
  outreachTarget,
  emailCadence,
  onUpdate,
}: JobReviewCardProps) {
  const [reportOpen, setReportOpen] = useState(false)

  const gradeStyle = job.grade ? GRADE_STYLES[job.grade] ?? GRADE_STYLES.D : ''
  const isSnoozed   = job.status === 'snoozed'
  const isApproved  = job.status === 'approved' || job.status === 'resume_ready' || job.status === 'submitted'
  const snoozedUntil = job.hitlCheckpoint?.snoozedUntil
  const dayAge       = getDayAge(job.postedAt)
  const isExpired    = dayAge !== null && dayAge > EXPIRY_WARNING_DAYS
  const isAgeing     = dayAge !== null && dayAge > AGE_AMBER_DAYS && !isExpired

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
                <span className={`flex items-center gap-1 text-[11px] ${
                  isExpired ? 'text-red-400' : isAgeing ? 'text-amber-400' : 'text-[#64748b]'
                }`}>
                  <Calendar className="w-3 h-3" />
                  {formatDate(job.postedAt)}
                  {dayAge !== null && (
                    <span className="opacity-70">· {formatRelativeAge(dayAge)}</span>
                  )}
                </span>
              )}
              {isExpired && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-red-800/50 text-red-400 bg-red-950/30 gap-1 px-1.5"
                  title="This posting is over 30 days old — the role may already be filled"
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  Likely expired
                </Badge>
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
            title={job.sourceUrl}
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

        {/* Generate Resume — shown on approved jobs that don't have a resume yet */}
        {job.status === 'approved' && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#0d1829]">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] px-3 border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
              onClick={() => onGenerateResume(job.id)}
              disabled={isPending}
              data-testid="generate-resume-btn"
            >
              <FileTextIcon className="w-3 h-3" />
              Generate Resume
            </Button>
          </div>
        )}

        {/* F5 Outreach status — shown on approved jobs once the connector has run */}
        {outreachTarget && job.status === 'approved' && (
          <div
            className="mt-3 pt-3 border-t border-[#0d1829] flex items-center gap-2"
            data-testid="outreach-section"
          >
            <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase shrink-0">
              Outreach
            </span>
            <OutreachStatusBadge status={outreachTarget.status} />
          </div>
        )}

        {/* F6 Email cadence status */}
        {emailCadence && job.status === 'approved' && (
          <div
            className="mt-2"
            data-testid="email-outreach-section"
          >
            {(emailCadence.status === 'email_not_found' || emailCadence.status === 'low_confidence' || emailCadence.status === 'failed') ? (
              <EmailNotFoundPanel
                jobId={job.id}
                candidateId={_candidateId}
                cadence={emailCadence}
                company={job.company ?? ''}
                outreachTarget={outreachTarget ?? null}
                onUpdate={onUpdate}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase shrink-0">
                  Email
                </span>
                <EmailCadenceStatusBadge status={emailCadence.status} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
