'use client'

import { useState } from 'react'
import { ExternalLink, FileTextIcon, DownloadIcon, MoreHorizontal, XCircle, CheckCheck, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { LazyScoreReportPane } from '@/components/applications/LazyScoreReportPane'
import { BuildProgressPane } from '@/components/applications/BuildProgressPane'
import { EmailCadenceStatusBadge } from '@/components/pipeline/EmailCadenceStatusBadge'
import { EmailOutreachPanel } from '@/components/pipeline/EmailOutreachPanel'
import { OutreachNoteSelector } from '@/components/pipeline/OutreachNoteSelector'
import { OutreachStatusBadge } from '@/components/pipeline/OutreachStatusBadge'
import type { ScoredJob, EmailCadenceSummary } from '@/lib/api'
import type { OutreachTargetSummary, OutreachStatus, EmailOutreachMode } from '@/types/candidate'

const GRADE_STYLES: Record<string, { badge: string }> = {
  A: { badge: 'bg-emerald-500 text-white border-transparent' },
  B: { badge: 'bg-blue-500   text-white border-transparent' },
  C: { badge: 'bg-amber-500  text-white border-transparent' },
  D: { badge: 'bg-orange-500 text-white border-transparent' },
  E: { badge: 'bg-rose-500   text-white border-transparent' },
  F: { badge: 'bg-red-600    text-white border-transparent' },
}

interface Props {
  job: ScoredJob
  onMarkSubmitted: (jobId: string) => void
  onMoveToRejected: (jobId: string) => void
  onRetryResume: (jobId: string) => void
  onViewResume?: (jobId: string) => void
  onViewCoverLetter?: (jobId: string) => void
  isPending: boolean
  candidateId: string
  emailOutreachMode?: EmailOutreachMode
}

export function JobCard({
  job,
  onMarkSubmitted,
  onMoveToRejected,
  onRetryResume,
  onViewResume,
  onViewCoverLetter,
  isPending,
  candidateId,
  emailOutreachMode = 'manual',
}: Props) {
  const [emailCadence, setEmailCadence] = useState<EmailCadenceSummary | null>(job.emailCadence)
  const [outreachStatus, setOutreachStatus] = useState<OutreachStatus | null>(
    job.outreachTarget?.status as OutreachStatus ?? null
  )
  const score = (job.score10d as Record<string, unknown> | null)?.numeric_score as number | undefined
  const isSnoozed   = job.status === 'snoozed'
  const isApproved  = job.status === 'approved'
  const isRejected  = job.status === 'rejected'
  const isSubmitted = job.status === 'submitted'
  const isResumeReady   = job.status === 'resume_ready'
  const isResumeFailed  = job.status === 'resume_failed'
  const gradeStyle = job.grade ? (GRADE_STYLES[job.grade] ?? GRADE_STYLES.F) : null

  return (
    <div className={`bg-[#0d1f3c] border rounded-xl p-4 flex flex-col gap-3 transition-opacity ${
      isSnoozed || isRejected ? 'border-[#1e2d4a] opacity-70' : 'border-[#1e2d4a]'
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
          {isApproved && (
            <Badge className="text-[10px] mt-1 bg-emerald-600 text-white border-transparent">Approved</Badge>
          )}
          {isResumeReady && (
            <Badge className="text-[10px] mt-1 bg-blue-600 text-white border-transparent">Resume ready</Badge>
          )}
          {isSubmitted && (
            <Badge className="text-[10px] mt-1 bg-cyan-700 text-white border-transparent">Submitted</Badge>
          )}
          {isResumeFailed && (
            <Badge variant="destructive" className="text-[10px] mt-1">Resume failed</Badge>
          )}
          {isSnoozed && (
            <Badge variant="secondary" className="text-[10px] mt-1">Snoozed</Badge>
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

      {/* View Report — above action buttons so it's always visible regardless
          of resume state. Lazy-loads on first expand. */}
      <LazyScoreReportPane jobId={job.id} />

      {/* Actions — post-decision tracking only */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {/* Resume in-flight */}
        {isApproved && (
          <Button size="sm" variant="outline"
            className="h-7 text-[11px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
            onClick={() => onViewResume?.(job.id)}
            disabled={isPending}>
            <FileTextIcon className="w-3 h-3" /> Resume building…
          </Button>
        )}

        {/* Resume ready / submitted — distinct side-pane previews */}
        {(isResumeReady || isSubmitted) && (
          <>
            <Button size="sm" variant="outline"
              className="h-7 text-[11px] gap-1 border-[#1e2d4a] text-[#93c5fd]"
              onClick={() => onViewResume?.(job.id)}
              disabled={isPending}>
              <FileTextIcon className="w-3 h-3" />
              View Resume
            </Button>
            <Button size="sm" variant="outline"
              className="h-7 text-[11px] gap-1 border-[#1e2d4a] text-[#93c5fd]"
              onClick={() => onViewCoverLetter?.(job.id)}
              disabled={isPending}>
              <FileTextIcon className="w-3 h-3" />
              View Cover Letter
            </Button>
          </>
        )}

        {/* Retry on failure */}
        {isResumeFailed && (
          <Button size="sm" variant="outline"
            className="h-7 text-[11px] border-red-700/40 text-red-400 hover:bg-red-950/30 gap-1"
            onClick={() => onRetryResume(job.id)}
            disabled={isPending}
            isLoading={isPending}>
            <RotateCcw className="w-3 h-3" />
            Retry Resume
          </Button>
        )}

        {/* Mark Submitted — only once resume is ready */}
        {isResumeReady && (
          <Button size="sm"
            className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-3 gap-1"
            onClick={() => onMarkSubmitted(job.id)}
            disabled={isPending}
            isLoading={isPending}>
            <CheckCheck className="w-3 h-3" /> Mark Submitted
          </Button>
        )}

        <div className="ml-auto flex gap-2 items-center flex-wrap justify-end">
          <Button size="sm" variant="ghost"
            className="h-7 w-7 p-0 text-[#475569] hover:text-[#94a3b8]" asChild>
            <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open job listing">
              <ExternalLink className="w-3 h-3" />
            </a>
          </Button>

          {!isRejected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost"
                  className="h-7 w-7 p-0 text-[#475569] hover:text-[#94a3b8]"
                  aria-label="More actions">
                  <MoreHorizontal className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={() => onMoveToRejected(job.id)}
                  className="text-red-400 focus:text-red-300">
                  <XCircle className="w-3 h-3 mr-2" />
                  Move to Rejected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Build-progress log — auto-opens while building or on failure */}
      {(isApproved || isResumeReady || isSubmitted || isResumeFailed) && (
        <BuildProgressPane jobId={job.id} autoOpen={isApproved || isResumeFailed} />
      )}

      {/* F5 LinkedIn Outreach — note selector + send button */}
      {job.outreachTarget && (
        <div className="border-t border-[#1e2d4a] pt-3 mt-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
              LinkedIn Outreach
            </span>
            <OutreachStatusBadge status={(outreachStatus ?? job.outreachTarget.status) as OutreachStatus} />
          </div>
          {(['notes_ready', 'no_contact_found', 'failed'] as OutreachStatus[]).includes(
            (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
          ) && (
            <OutreachNoteSelector
              target={{ ...job.outreachTarget, status: (outreachStatus ?? job.outreachTarget.status) as OutreachStatus }}
              candidateId={candidateId}
              jobId={job.id}
              onStatusChange={(s) => setOutreachStatus(s)}
            />
          )}
        </div>
      )}

      {/* F6 Email cadence — status badge + full draft review panel */}
      {emailCadence && (
        <div className="border-t border-[#1e2d4a] pt-3 mt-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
              Email
            </span>
            <EmailCadenceStatusBadge status={emailCadence.status} />
          </div>
          {(emailCadence.status === 'pending_approval' ||
            emailCadence.status === 'active' ||
            emailCadence.status === 'low_confidence' ||
            emailCadence.status === 'replied' ||
            emailCadence.status === 'bounced' ||
            emailCadence.status === 'auth_expired' ||
            emailCadence.status === 'attachment_missing') && (
            <EmailOutreachPanel
              cadence={emailCadence}
              candidateId={candidateId}
              mode={emailOutreachMode}
              onCadenceUpdated={setEmailCadence}
            />
          )}
        </div>
      )}
    </div>
  )
}
