'use client'

import { useState } from 'react'
import { ExternalLink, FileTextIcon, DownloadIcon, MoreHorizontal, XCircle, CheckCheck, RotateCcw, Link2, MailIcon } from 'lucide-react'
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
import { retryLinkedIn, startEmailOutreach } from '@/lib/api'
import type { OutreachTargetSummary, OutreachStatus, EmailOutreachMode, EmailCadenceStatus } from '@/types/candidate'

const LINKEDIN_TRANSIENT: OutreachStatus[] = ['pending', 'discovering', 'enriching', 'generating']
const EMAIL_TRANSIENT: EmailCadenceStatus[] = ['pending_discovery', 'discovering', 'generating']

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
  onGenerateResume: (jobId: string) => void
  onRetryResume: (jobId: string) => void
  onBuildComplete?: (jobId: string) => void
  onViewResume?: (jobId: string) => void
  onViewCoverLetter?: (jobId: string) => void
  isPending: boolean
  candidateId: string
  emailOutreachMode?: EmailOutreachMode
  emailResumeAttachment?: 'tailored' | 'original'
}

export function JobCard({
  job,
  onMarkSubmitted,
  onMoveToRejected,
  onGenerateResume,
  onRetryResume,
  onBuildComplete,
  onViewResume,
  onViewCoverLetter,
  isPending,
  candidateId,
  emailOutreachMode = 'manual',
  emailResumeAttachment = 'tailored',
}: Props) {
  const [emailCadence, setEmailCadence]     = useState<EmailCadenceSummary | null>(job.emailCadence)
  const [outreachStatus, setOutreachStatus] = useState<OutreachStatus | null>(
    job.outreachTarget?.status as OutreachStatus ?? null
  )
  const [liStarting,  setLiStarting]  = useState(false)
  const [emStarting,  setEmStarting]  = useState(false)
  // Tracks build failure detected by BuildProgressPane polling — covers the case
  // where the pipeline job fails before the DB job status flips to resume_failed.
  const [localResumeFailed, setLocalResumeFailed] = useState(false)
  // True while BuildProgressPane is actively polling a running pipeline job.
  const [buildRunning, setBuildRunning] = useState(false)
  // Incremented on each retry to force BuildProgressPane to remount and re-fetch.
  const [retryCount, setRetryCount] = useState(0)
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
        {/* Generate Resume — shown on approved jobs; disabled while a build is running */}
        {isApproved && !localResumeFailed && (
          <Button size="sm" variant="outline"
            className="h-7 text-[11px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
            onClick={() => onGenerateResume(job.id)}
            disabled={isPending || buildRunning}
            isLoading={buildRunning}>
            <FileTextIcon className="w-3 h-3" />
            {buildRunning ? 'Building…' : 'Generate Resume'}
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

        {/* Retry on failure — covers both DB-level resume_failed and
            locally-detected pipeline job failure. Disabled while a build
            is actively running to prevent double-submissions. */}
        {(isResumeFailed || localResumeFailed) && (
          <Button size="sm" variant="outline"
            className="h-7 text-[11px] border-red-700/40 text-red-400 hover:bg-red-950/30 gap-1"
            onClick={() => {
              setLocalResumeFailed(false)
              setBuildRunning(false)
              setRetryCount((c) => c + 1)
              onRetryResume(job.id)
            }}
            disabled={isPending || buildRunning}
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
        <BuildProgressPane
          key={retryCount}
          jobId={job.id}
          autoOpen={isResumeFailed || localResumeFailed}
          onBuildFailed={() => setLocalResumeFailed(true)}
          onBuildComplete={() => onBuildComplete?.(job.id)}
          onRunningChange={setBuildRunning}
        />
      )}

      {/* F5 LinkedIn Outreach */}
      {(isApproved || isResumeReady || isSubmitted) && (
        <div className="border-t border-[#1e2d4a] pt-3 mt-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
              LinkedIn Outreach
            </span>

            {/* No outreach yet — daemon queued, show animated waiting state */}
            {!job.outreachTarget && (
              <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Searching for contact…
              </span>
            )}

            {/* Transient state — show phase label + Retry as fallback */}
            {job.outreachTarget && LINKEDIN_TRANSIENT.includes(
              (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
            ) && (
              <>
                <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {(outreachStatus ?? job.outreachTarget.status) === 'discovering'  && 'Discovering contact…'}
                  {(outreachStatus ?? job.outreachTarget.status) === 'enriching'    && 'Enriching profile…'}
                  {(outreachStatus ?? job.outreachTarget.status) === 'generating'   && 'Generating notes…'}
                  {(outreachStatus ?? job.outreachTarget.status) === 'pending'      && 'Starting…'}
                </span>
              </>
            )}

            {/* Retry — only show when outreach target exists and is in transient state (for manual retry) */}
            {job.outreachTarget && LINKEDIN_TRANSIENT.includes(
              (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
            ) && (
              <Button size="sm" variant="outline"
                className="h-6 text-[10px] border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1"
                isLoading={liStarting}
                onClick={async () => {
                  setLiStarting(true)
                  try {
                    await retryLinkedIn(job.id, candidateId)
                    setOutreachStatus('discovering')
                  } finally { setLiStarting(false) }
                }}>
                <RotateCcw className="w-3 h-3" />
                Retry
              </Button>
            )}

            {/* Terminal / action states → badge */}
            {job.outreachTarget && !LINKEDIN_TRANSIENT.includes(
              (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
            ) && (
              <OutreachStatusBadge status={(outreachStatus ?? job.outreachTarget.status) as OutreachStatus} />
            )}
          </div>

          {/* Target profile link + contact source badge */}
          {job.outreachTarget?.name && (
            <div className="flex flex-col gap-1 mt-1.5">
              <div className="flex items-center gap-1.5">
                <Link2 className="w-3 h-3 text-[#0A66C2] flex-shrink-0" />
                {job.outreachTarget.linkedinUrl ? (
                  <a
                    href={job.outreachTarget.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#60a5fa] hover:underline truncate"
                  >
                    {job.outreachTarget.name}
                    {job.outreachTarget.title && (
                      <span className="text-[#475569]"> · {job.outreachTarget.title}</span>
                    )}
                  </a>
                ) : (
                  <span className="text-[10px] text-[#64748b]">
                    {job.outreachTarget.name}
                    {job.outreachTarget.title && (
                      <span className="text-[#475569]"> · {job.outreachTarget.title}</span>
                    )}
                  </span>
                )}
              </div>
              {/* Source badge — transparency about how this contact was identified */}
              <span
                className={`self-start text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                  job.outreachTarget.seniority === 'JOB_POSTER'
                    ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40'
                    : 'bg-amber-950/50 text-amber-400 border-amber-800/40'
                }`}
                title={
                  job.outreachTarget.seniority === 'JOB_POSTER'
                    ? "Identified from the 'Meet the hiring team' section of the job posting"
                    : "Found via AI-powered role analysis — not directly from the job posting"
                }
              >
                {job.outreachTarget.seniority === 'JOB_POSTER' ? '📋 From JD' : '✨ AI Match'}
              </span>
            </div>
          )}

          {/* Notes selector — show whenever notes exist (noteA/noteB populated),
              even if status is transient. This covers stale-status cases where
              the daemon generated notes but then crashed before marking notes_ready. */}
          {job.outreachTarget && (
            (['notes_ready', 'no_contact_found', 'failed'] as OutreachStatus[]).includes(
              (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
            ) || (!!job.outreachTarget.noteA && !!job.outreachTarget.noteB)
          ) && (
            <div className="mt-2">
              <OutreachNoteSelector
                target={{ ...job.outreachTarget, status: (outreachStatus ?? job.outreachTarget.status) as OutreachStatus }}
                candidateId={candidateId}
                jobId={job.id}
                onStatusChange={(s) => setOutreachStatus(s)}
              />
            </div>
          )}
        </div>
      )}

      {/* F6 Email Outreach */}
      {(isApproved || isResumeReady || isSubmitted) && (
        <div className="border-t border-[#1e2d4a] pt-3 mt-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
              Email
            </span>

            {/* No cadence yet — daemon queued, show animated waiting state */}
            {!emailCadence && (
              <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Finding email…
              </span>
            )}

            {/* Email transient — show phase + keep Retry */}
            {emailCadence && EMAIL_TRANSIENT.includes(emailCadence.status) && (
              <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                {emailCadence.status === 'pending_discovery' && 'Starting…'}
                {emailCadence.status === 'discovering'       && 'Discovering email…'}
                {emailCadence.status === 'generating'        && 'Drafting emails…'}
              </span>
            )}

            {/* No cadence yet — also keep Start button as manual override */}
            {!emailCadence && (
              <Button size="sm" variant="outline"
                className="h-6 text-[10px] border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1 ml-1"
                isLoading={emStarting}
                onClick={async () => {
                  setEmStarting(true)
                  try {
                    await startEmailOutreach(job.id, candidateId)
                    setEmailCadence({ id: '', status: 'pending_discovery', hiringManagerEmail: null,
                      emailConfidence: null, approvedAt: null, replyDetectedAt: null, bounceDetectedAt: null, retryCount: 0, drafts: [] })
                  } finally { setEmStarting(false) }
                }}>
                Start
              </Button>
            )}

            {/* Transient or terminal-failed state → Retry */}
            {emailCadence && (
              EMAIL_TRANSIENT.includes(emailCadence.status) ||
              emailCadence.status === 'failed' ||
              emailCadence.status === 'email_not_found' ||
              emailCadence.status === 'cancelled'
            ) && (
              <Button size="sm" variant="outline"
                className="h-6 text-[10px] border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1"
                isLoading={emStarting}
                onClick={async () => {
                  setEmStarting(true)
                  try {
                    await startEmailOutreach(job.id, candidateId)
                    setEmailCadence({ id: '', status: 'pending_discovery', hiringManagerEmail: null,
                      emailConfidence: null, approvedAt: null, replyDetectedAt: null, bounceDetectedAt: null, retryCount: 0, drafts: [] })
                  } catch (e) {
                    // 409 means server moved past transient state while UI was stale — sync local state so UI self-corrects
                    if (e instanceof Error && e.message.startsWith('409')) {
                      try {
                        const body = JSON.parse(e.message.replace(/^\d+:\s*/, ''))
                        if (body.currentStatus && emailCadence) {
                          setEmailCadence({ ...emailCadence, status: body.currentStatus as EmailCadenceStatus })
                        }
                      } catch { /* ignore JSON parse failure */ }
                    } else if (e instanceof Error && e.message.startsWith('429')) {
                      if (emailCadence) {
                        setEmailCadence({ ...emailCadence, retryCount: 2 })
                      }
                    }
                  } finally { setEmStarting(false) }
                }}>
                <RotateCcw className="w-3 h-3" />
                Retry
              </Button>
            )}

            {/* Badge only for non-transient states */}
            {emailCadence && !EMAIL_TRANSIENT.includes(emailCadence.status) && (
              <EmailCadenceStatusBadge status={emailCadence.status} />
            )}
          </div>

          {/* Hiring manager email — show as soon as it's discovered */}
          {emailCadence?.hiringManagerEmail && (
            <div className="flex items-center gap-1.5 mb-2">
              <MailIcon className="w-3 h-3 text-[#475569] flex-shrink-0" />
              <span className="text-[10px] text-[#64748b] font-mono truncate">
                {emailCadence.hiringManagerEmail}
              </span>
            </div>
          )}

          {emailCadence && (
            emailCadence.status === 'pending_approval' ||
            emailCadence.status === 'active' ||
            emailCadence.status === 'low_confidence' ||
            emailCadence.status === 'replied' ||
            emailCadence.status === 'bounced' ||
            emailCadence.status === 'auth_expired' ||
            emailCadence.status === 'attachment_missing'
          ) && (
            <EmailOutreachPanel
              cadence={emailCadence}
              candidateId={candidateId}
              jobId={job.id}
              mode={emailOutreachMode}
              attachmentMode={emailResumeAttachment}
              onCadenceUpdated={setEmailCadence}
            />
          )}
        </div>
      )}
    </div>
  )
}
