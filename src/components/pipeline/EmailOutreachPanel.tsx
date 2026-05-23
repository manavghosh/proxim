'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Paperclip, FileText, Pencil, Check, X, Lightbulb } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { approveCadence, overrideEmail, startCountdown, cancelCadence, retryCadenceGeneration } from '@/lib/api'
import { PdfPreviewSheet } from '@/components/applications/PdfPreviewSheet'
import { EmailDraftCard } from './EmailDraftCard'
import { ManualSendDraftCard } from './ManualSendDraftCard'
import type { EmailCadenceSummary, EmailDraftSummary, EmailOutreachMode } from '@/types/candidate'

interface Props {
  cadence: EmailCadenceSummary
  candidateId: string
  jobId?: string
  mode?: EmailOutreachMode
  attachmentMode?: 'tailored' | 'original'
  suggestedEmail?: string | null
  suggestedEmailConfidence?: number | null
  onCadenceUpdated: (c: EmailCadenceSummary) => void
}

const DAY_LABELS: Record<number, string> = { 1: 'Day 1', 3: 'Day 3', 7: 'Day 7' }
const DAY_SUBLABELS: Record<number, string> = { 1: 'Intro', 3: 'Value add', 7: 'Gentle close' }

export function EmailOutreachPanel({ cadence: initialCadence, candidateId, jobId, mode = 'manual', attachmentMode = 'tailored', suggestedEmail, suggestedEmailConfidence, onCadenceUpdated }: Props) {
  const [cadence, setCadence]               = useState(initialCadence)
  // Deduplicate by dayNumber — keep the last entry per day in case the daemon
  // re-ran and inserted duplicate rows before the DB-level fix was applied.
  const [drafts, setDrafts] = useState<EmailDraftSummary[]>(() => {
    const seen = new Map<number, EmailDraftSummary>()
    for (const d of initialCadence.drafts) seen.set(d.dayNumber, d)
    return [1, 3, 7].flatMap(day => seen.has(day) ? [seen.get(day)!] : [])
  })
  const [activeTab, setActiveTab]           = useState('1')
  const [isApproving, setIsApproving]       = useState(false)
  const [approveError, setApproveError]     = useState<string | null>(null)
  const [resumePreviewOpen, setResumePreviewOpen] = useState(false)
  const [isOverriding, setIsOverriding]     = useState(false)
  const [isCancelling, setIsCancelling]     = useState(false)
  const [editingEmail, setEditingEmail]     = useState(false)
  const [emailDraft, setEmailDraft]         = useState('')
  const [savingEmail, setSavingEmail]       = useState(false)
  const [isStarting, setIsStarting]         = useState(false)
  const [isRetrying, setIsRetrying]         = useState(false)
  const [day1GmailOpened, setDay1GmailOpened] = useState(false)
  const [usingSuggestion, setUsingSuggestion] = useState(false)

  function handleDraftUpdated(updated: EmailDraftSummary) {
    setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d))
  }

  function handleDraftSent(draftId: string) {
    setDrafts(prev => prev.map(d =>
      d.id === draftId ? { ...d, status: 'manually_sent' as const, sentAt: new Date().toISOString() } : d
    ))
  }

  async function handleApprove() {
    setIsApproving(true)
    setApproveError(null)
    try {
      const result = await approveCadence(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status, approvedAt: result.approvedAt, drafts }
      setCadence(updated)
      onCadenceUpdated(updated)
    } catch (e) {
      setApproveError(e instanceof Error ? e.message.replace(/^\d+:\s*/, '') : 'Failed to approve. Please try again.')
    } finally { setIsApproving(false) }
  }

  async function handleStartCountdown() {
    setIsStarting(true)
    try {
      const result = await startCountdown(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: 'active', drafts }
      setCadence(updated)
      onCadenceUpdated(updated)
      setDrafts(prev => prev.map(d => {
        if (d.dayNumber === 3) return { ...d, status: 'approved' as const, scheduledSendAt: result.day3Due }
        if (d.dayNumber === 7) return { ...d, status: 'approved' as const, scheduledSendAt: result.day7Due }
        return d
      }))
    } finally { setIsStarting(false) }
  }

  async function handleCancel() {
    setIsCancelling(true)
    try {
      const result = await cancelCadence(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status as EmailCadenceSummary['status'], drafts }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally { setIsCancelling(false) }
  }

  async function handleOverride() {
    if (!cadence.hiringManagerEmail) return
    setIsOverriding(true)
    try {
      const result = await overrideEmail(cadence.id, candidateId, cadence.hiringManagerEmail)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally { setIsOverriding(false) }
  }

  async function handleSaveEmail() {
    if (!emailDraft.includes('@')) return
    setSavingEmail(true)
    try {
      const result = await overrideEmail(cadence.id, candidateId, emailDraft)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status, hiringManagerEmail: emailDraft }
      setCadence(updated)
      onCadenceUpdated(updated)
      setEditingEmail(false)
    } catch { /* leave input open so user can retry */ }
    finally { setSavingEmail(false) }
  }

  const showDraftTabs = (
    cadence.status === 'pending_approval' ||
    cadence.status === 'approved' ||
    cadence.status === 'active' ||
    // Show drafts even when email is unverified — drafts are generated regardless
    cadence.status === 'email_not_found' ||
    cadence.status === 'low_confidence'
  ) && drafts.length > 0

  const needsEmail = !cadence.hiringManagerEmail && (
    cadence.status === 'pending_approval' ||
    cadence.status === 'email_not_found' ||
    cadence.status === 'low_confidence'
  )

  const isManual = mode === 'manual'

  function tabLabel(d: EmailDraftSummary): string {
    if (d.status === 'sent' || d.status === 'manually_sent') return `${DAY_LABELS[d.dayNumber]} ✓`
    if (d.scheduledSendAt && cadence.status === 'active') {
      const diffD = Math.ceil((new Date(d.scheduledSendAt).getTime() - Date.now()) / 86400000)
      if (diffD < 0) return `${DAY_LABELS[d.dayNumber]} ⚠`
      return `${DAY_LABELS[d.dayNumber]} · ${diffD}d`
    }
    return DAY_LABELS[d.dayNumber]
  }

  return (
    <div data-testid="email-outreach-panel" className="space-y-3">
      <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Email Outreach</p>

      {/* Editable recipient email — shown whenever an email address is known */}
      {cadence.hiringManagerEmail && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
          {!editingEmail ? (
            <>
              <span className="text-[10px] text-[#475569] shrink-0">To:</span>
              <span className="text-[10px] text-[#94a3b8] font-mono truncate flex-1">
                {cadence.hiringManagerEmail}
              </span>
              <Button
                size="xs"
                variant="ghost"
                className="h-5 w-5 p-0 text-[#475569] hover:text-[#93c5fd] shrink-0"
                onClick={() => { setEmailDraft(cadence.hiringManagerEmail ?? ''); setEditingEmail(true) }}
                title="Change recipient email"
              >
                <Pencil className="w-3 h-3" />
              </Button>
            </>
          ) : (
            <>
              <Input
                autoFocus
                value={emailDraft}
                onChange={e => setEmailDraft(e.target.value)}
                placeholder="recipient@company.com"
                className="h-6 text-[10px] bg-[#060d1f] border-[#2d4a6e] text-[#f1f5f9] flex-1"
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleSaveEmail()
                  if (e.key === 'Escape') setEditingEmail(false)
                }}
              />
              <Button
                size="xs"
                variant="ghost"
                className="h-5 w-5 p-0 text-emerald-400 hover:text-emerald-300 shrink-0"
                onClick={handleSaveEmail}
                disabled={!emailDraft.includes('@') || savingEmail}
                title="Save"
              >
                <Check className="w-3 h-3" />
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="h-5 w-5 p-0 text-[#475569] hover:text-[#94a3b8] shrink-0"
                onClick={() => setEditingEmail(false)}
                title="Cancel"
              >
                <X className="w-3 h-3" />
              </Button>
            </>
          )}
          </div>
          {/* Confidence warning — shown when AI Agent found email but couldn't verify it individually */}
          {!editingEmail && cadence.emailConfidence !== null && cadence.emailConfidence < 80 && (
            <p className="text-[10px] text-amber-400/80 flex items-center gap-1">
              <span>△</span>
              Found by AI Agent · {cadence.emailConfidence}% confidence · catch-all domain — verify before sending
            </p>
          )}
        </div>
      )}

      {/* LinkedIn contact email suggestion — shown when F5 found an email but F6 hasn't yet */}
      {needsEmail && suggestedEmail && (
        <div
          data-testid="linkedin-email-suggestion"
          className="rounded-lg border border-blue-800/40 bg-blue-950/20 px-3 py-2 space-y-1.5"
        >
          <div className="flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3 text-blue-400 shrink-0" />
            <span className="text-[10px] text-blue-300 font-medium">From LinkedIn contact</span>
            {suggestedEmailConfidence != null && (
              <span className="text-[10px] text-blue-400/70">· {suggestedEmailConfidence}% confidence</span>
            )}
          </div>
          <p className="text-[11px] font-mono text-[#f1f5f9]">{suggestedEmail}</p>
          <Button
            data-testid="use-linkedin-email-btn"
            size="sm"
            className="h-6 text-[10px] bg-blue-600 hover:bg-blue-700 text-white gap-1"
            isLoading={usingSuggestion}
            onClick={async () => {
              setUsingSuggestion(true)
              try {
                const result = await overrideEmail(cadence.id, candidateId, suggestedEmail)
                const updated: EmailCadenceSummary = { ...cadence, status: result.status, hiringManagerEmail: suggestedEmail }
                setCadence(updated)
                onCadenceUpdated(updated)
              } finally { setUsingSuggestion(false) }
            }}
          >
            Use this
          </Button>
        </div>
      )}

      {/* Email entry required — shown when drafts exist but no email address is set */}
      {needsEmail && (
        <div className="rounded-lg bg-amber-950/30 border border-amber-800/40 px-3 py-2.5 space-y-2">
          <p className="text-[10px] text-amber-300 font-medium">Enter recipient email to schedule sending</p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={emailDraft}
              onChange={e => setEmailDraft(e.target.value)}
              placeholder="hiring@company.com"
              className="h-7 flex-1 rounded-md border border-[#2d4a6e] bg-[#060d1f] px-2 text-[11px] text-[#f1f5f9] outline-none focus:border-blue-500"
              onKeyDown={e => { if (e.key === 'Enter') void handleSaveEmail() }}
            />
            <Button
              size="sm"
              className="h-7 text-[10px] bg-amber-600 hover:bg-amber-700 text-white shrink-0 px-3"
              onClick={handleSaveEmail}
              disabled={!emailDraft.includes('@') || savingEmail}
              isLoading={savingEmail}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {showDraftTabs && (
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              {drafts.map(d => (
                <TabsTrigger key={d.id} value={String(d.dayNumber)} className="flex-1 flex-col gap-0 py-2">
                  <span className="text-[11px] font-semibold">{tabLabel(d)}</span>
                  <span className="text-[9px] opacity-60">{DAY_SUBLABELS[d.dayNumber]}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {drafts.map(d => (
              <TabsContent key={d.id} value={String(d.dayNumber)} forceMount
                className={String(d.dayNumber) !== activeTab ? 'hidden' : ''}>
                {isManual ? (
                  <ManualSendDraftCard
                    draft={d}
                    cadenceId={cadence.id}
                    candidateId={candidateId}
                    hiringManagerEmail={cadence.hiringManagerEmail ?? ''}
                    scheduledAt={d.scheduledSendAt}
                    onDraftSent={handleDraftSent}
                    onGmailOpened={d.dayNumber === 1 ? () => setDay1GmailOpened(true) : undefined}
                  />
                ) : (
                  <EmailDraftCard
                    draft={d}
                    cadenceId={cadence.id}
                    candidateId={candidateId}
                    onDraftUpdated={handleDraftUpdated}
                  />
                )}
              </TabsContent>
            ))}
          </Tabs>

          {/* Attachment indicator + View Resume — shows what will be sent with Day 1 */}
          {cadence.status === 'pending_approval' && (
            <div className="rounded-lg border border-[#1e2d4a] bg-[#080f1e] px-3 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[10px] text-[#475569] min-w-0">
                <Paperclip className="w-3 h-3 shrink-0 text-[#60a5fa]" />
                <span className="truncate">
                  Day 1 will include{' '}
                  <span className="text-[#93c5fd]">
                    {attachmentMode === 'original'
                      ? 'your original resume'
                      : 'the tailored AI resume for this role'}
                  </span>
                  {' '}as an attachment.
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] shrink-0 border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1"
                onClick={() => setResumePreviewOpen(true)}
                disabled={attachmentMode === 'tailored' && !jobId}
              >
                <FileText className="w-3 h-3" />
                View
              </Button>
            </div>
          )}

          {/* PDF preview sheet */}
          {resumePreviewOpen && (
            <PdfPreviewSheet
              open={resumePreviewOpen}
              onOpenChange={setResumePreviewOpen}
              {...(attachmentMode === 'original'
                ? {
                    url: `/api/cv/base-pdf?candidateId=${candidateId}`,
                    title: 'Original Resume',
                  }
                : {
                    jobId: jobId ?? '',
                    type: 'resume',
                    title: 'Tailored AI Resume',
                  })}
            />
          )}

          {/* Agentic: pending_approval → Approve & Send */}
          {cadence.status === 'pending_approval' && !isManual && (
            <Button onClick={handleApprove} isLoading={isApproving}
              disabled={needsEmail || isApproving}
              data-testid="approve-cadence-btn" className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {needsEmail ? 'Enter email above to send' : 'Approve & Send Day 1 Now'}
            </Button>
          )}

          {/* Manual: pending_approval → Approve Drafts */}
          {cadence.status === 'pending_approval' && isManual && (
            <Button onClick={handleApprove} isLoading={isApproving}
              disabled={needsEmail || isApproving}
              data-testid="approve-cadence-btn" className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {needsEmail ? 'Enter email above to schedule' : 'Approve Drafts'}
            </Button>
          )}

          {approveError && (
            <p className="text-xs text-red-400 text-center">{approveError}</p>
          )}

          {/* Manual: approved → Start countdown (enabled after Day 1 Gmail opened) */}
          {cadence.status === 'approved' && isManual && (
            <div className="space-y-2">
              <p className="text-[10px] text-[#64748b]">
                Open Day 1 in Gmail, send it, then start the countdown for Day 3 and Day 7.
              </p>
              <Button
                onClick={handleStartCountdown}
                isLoading={isStarting}
                disabled={!day1GmailOpened}
                data-testid="start-countdown-btn"
                className="w-full text-xs"
                variant="outline"
              >
                Start Day 3/7 Countdown
              </Button>
              {!day1GmailOpened && (
                <p className="text-[10px] text-[#475569]">Open Day 1 in Gmail first to enable this button.</p>
              )}
            </div>
          )}

          {/* Manual: active → Stop cadence */}
          {cadence.status === 'active' && isManual && (
            <Button onClick={handleCancel} isLoading={isCancelling}
              data-testid="cancel-cadence-btn" variant="outline" size="sm"
              className="w-full text-xs border-red-800/40 text-red-400 hover:bg-red-950/20">
              Stop cadence
            </Button>
          )}
        </>
      )}

      {/* Low confidence */}
      {cadence.status === 'low_confidence' && (
        <div data-testid="low-confidence-notice" className="space-y-2 rounded-md border border-orange-700/40 bg-orange-950/20 p-3">
          <p className="text-xs text-orange-300">
            Low confidence email: <span className="font-mono">{cadence.hiringManagerEmail}</span>
            {cadence.emailConfidence != null && (
              <Badge className="ml-2 bg-orange-100 text-orange-800 text-[10px]">{cadence.emailConfidence}% confidence</Badge>
            )}
          </p>
          <Button size="sm" variant="outline" onClick={handleOverride} isLoading={isOverriding} data-testid="override-email-btn">
            Send Anyway
          </Button>
        </div>
      )}

      {(cadence.status === 'failed' || cadence.status === 'email_not_found') && (
        <div className="space-y-2">
          <p className="text-xs text-[#475569]">
            {cadence.status === 'failed'
              ? 'Email draft generation failed — the AI Agent will retry, or you can trigger it now.'
              : 'No email address found for this company domain.'}
          </p>
          <Button
            size="sm" variant="outline"
            className="text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1.5"
            isLoading={isRetrying}
            data-testid="retry-email-btn"
            onClick={async () => {
              setIsRetrying(true)
              try {
                await retryCadenceGeneration(cadence.id, candidateId)
                const updated: EmailCadenceSummary = { ...cadence, status: 'generating' }
                setCadence(updated)
                onCadenceUpdated(updated)
              } finally { setIsRetrying(false) }
            }}
          >
            <span>↺</span>
            {cadence.status === 'failed' ? 'Retry email generation' : 'Retry with domain search'}
          </Button>
        </div>
      )}
      {cadence.status === 'replied' && (
        <Alert className="border-emerald-700/40 bg-emerald-950/20" data-testid="reply-received-banner">
          <AlertDescription className="text-emerald-300 text-xs">Reply received — cadence paused. Great work!</AlertDescription>
        </Alert>
      )}
      {cadence.status === 'bounced' && (
        <Alert className="border-red-700/40 bg-red-950/20" data-testid="bounce-cancelled-banner">
          <AlertDescription className="text-red-300 text-xs">Day 1 bounced — Day 3 and Day 7 cancelled.</AlertDescription>
        </Alert>
      )}
      {cadence.status === 'cancelled' && (
        <p className="text-xs text-[#475569]">Cadence cancelled.</p>
      )}
      {cadence.status === 'cadence_complete' && (
        <p className="text-xs text-[#475569]">Cadence complete — no reply received after 3 emails.</p>
      )}
      {cadence.status === 'auth_expired' && (
        <Alert className="border-orange-700/40 bg-orange-950/20" data-testid="auth-expired-banner">
          <AlertDescription className="text-orange-300 text-xs">Re-authorise Gmail to resume your email cadence.</AlertDescription>
        </Alert>
      )}
      {cadence.status === 'attachment_missing' && (
        <div data-testid="attachment-missing-notice" className="flex items-center gap-2 text-xs text-[#475569]">
          <Spinner className="size-3" />
          Awaiting resume PDF — Day 1 will send once available.
        </div>
      )}
    </div>
  )
}
