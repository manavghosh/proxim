'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { approveCadence, overrideEmail, startCountdown, cancelCadence, retryCadenceGeneration } from '@/lib/api'
import { EmailDraftCard } from './EmailDraftCard'
import { ManualSendDraftCard } from './ManualSendDraftCard'
import type { EmailCadenceSummary, EmailDraftSummary, EmailOutreachMode } from '@/types/candidate'

interface Props {
  cadence: EmailCadenceSummary
  candidateId: string
  mode?: EmailOutreachMode
  onCadenceUpdated: (c: EmailCadenceSummary) => void
}

const DAY_LABELS: Record<number, string> = { 1: 'Day 1', 3: 'Day 3', 7: 'Day 7' }
const DAY_SUBLABELS: Record<number, string> = { 1: 'Intro', 3: 'Value add', 7: 'Gentle close' }

export function EmailOutreachPanel({ cadence: initialCadence, candidateId, mode = 'manual', onCadenceUpdated }: Props) {
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
  const [isOverriding, setIsOverriding]     = useState(false)
  const [isCancelling, setIsCancelling]     = useState(false)
  const [isStarting, setIsStarting]         = useState(false)
  const [isRetrying, setIsRetrying]         = useState(false)
  const [day1GmailOpened, setDay1GmailOpened] = useState(false)

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

  const showDraftTabs = (
    cadence.status === 'pending_approval' ||
    cadence.status === 'approved' ||
    cadence.status === 'active'
  ) && drafts.length > 0

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

          {/* Agentic: pending_approval → Approve & Send */}
          {cadence.status === 'pending_approval' && !isManual && (
            <Button onClick={handleApprove} isLoading={isApproving}
              data-testid="approve-cadence-btn" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Approve & Send Day 1 Now
            </Button>
          )}

          {/* Manual: pending_approval → Approve Drafts */}
          {cadence.status === 'pending_approval' && isManual && (
            <Button onClick={handleApprove} isLoading={isApproving}
              data-testid="approve-cadence-btn" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Approve Drafts
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
              ? 'Email draft generation failed — the daemon will retry, or you can trigger it now.'
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
