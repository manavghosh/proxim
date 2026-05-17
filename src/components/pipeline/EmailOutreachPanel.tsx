'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { approveCadence, overrideEmail } from '@/lib/api'
import { EmailDraftCard } from './EmailDraftCard'
import type { EmailCadenceSummary, EmailDraftSummary } from '@/types/candidate'

interface Props {
  cadence: EmailCadenceSummary
  candidateId: string
  onCadenceUpdated: (c: EmailCadenceSummary) => void
}

export function EmailOutreachPanel({ cadence: initialCadence, candidateId, onCadenceUpdated }: Props) {
  const [cadence, setCadence] = useState(initialCadence)
  const [isApproving, setIsApproving] = useState(false)
  const [isOverriding, setIsOverriding] = useState(false)
  const [drafts, setDrafts] = useState<EmailDraftSummary[]>(initialCadence.drafts)

  function handleDraftUpdated(updated: EmailDraftSummary) {
    setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d))
  }

  async function handleApprove() {
    setIsApproving(true)
    try {
      const result = await approveCadence(cadence.id, candidateId)
      const updated: EmailCadenceSummary = {
        ...cadence,
        status: result.status,
        approvedAt: result.approvedAt,
        drafts,
      }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally {
      setIsApproving(false)
    }
  }

  async function handleOverride() {
    if (!cadence.hiringManagerEmail) return
    setIsOverriding(true)
    try {
      const result = await overrideEmail(cadence.id, candidateId, cadence.hiringManagerEmail)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally {
      setIsOverriding(false)
    }
  }

  return (
    <div data-testid="email-outreach-panel" className="space-y-3">
      <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Email Outreach</p>

      {cadence.status === 'pending_approval' && (
        <>
          <div className="space-y-2">
            {drafts.map(d => (
              <EmailDraftCard
                key={d.id}
                draft={d}
                cadenceId={cadence.id}
                candidateId={candidateId}
                onDraftUpdated={handleDraftUpdated}
              />
            ))}
          </div>
          <Button
            onClick={handleApprove}
            isLoading={isApproving}
            data-testid="approve-cadence-btn"
            className="w-full"
          >
            Approve & Send
          </Button>
        </>
      )}

      {cadence.status === 'active' && (
        <div className="space-y-2">
          {drafts.map(d => (
            <EmailDraftCard
              key={d.id}
              draft={d}
              cadenceId={cadence.id}
              candidateId={candidateId}
              onDraftUpdated={handleDraftUpdated}
            />
          ))}
        </div>
      )}

      {cadence.status === 'low_confidence' && (
        <div data-testid="low-confidence-notice" className="space-y-2 rounded-md border border-orange-700/40 bg-orange-950/20 p-3">
          <p className="text-xs text-orange-300">
            Low confidence email: <span className="font-mono">{cadence.hiringManagerEmail}</span>
            {cadence.emailConfidence != null && (
              <Badge className="ml-2 bg-orange-100 text-orange-800 text-[10px]">{cadence.emailConfidence}% confidence</Badge>
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={handleOverride}
            isLoading={isOverriding}
            data-testid="override-email-btn"
          >
            Send Anyway
          </Button>
        </div>
      )}

      {cadence.status === 'email_not_found' && (
        <p className="text-xs text-[#475569]">Email not found for this company domain.</p>
      )}

      {cadence.status === 'replied' && (
        <Alert className="border-emerald-700/40 bg-emerald-950/20" data-testid="reply-received-banner">
          <AlertDescription className="text-emerald-300 text-xs">
            Reply received — cadence paused. Great work!
          </AlertDescription>
        </Alert>
      )}

      {cadence.status === 'bounced' && (
        <Alert className="border-red-700/40 bg-red-950/20" data-testid="bounce-cancelled-banner">
          <AlertDescription className="text-red-300 text-xs">
            Day 1 bounced — cadence cancelled. Day 3 and Day 7 have been cancelled.
          </AlertDescription>
        </Alert>
      )}

      {cadence.status === 'cadence_complete' && (
        <p className="text-xs text-[#475569]">Cadence complete — no reply received after 3 emails.</p>
      )}

      {cadence.status === 'auth_expired' && (
        <Alert className="border-orange-700/40 bg-orange-950/20" data-testid="auth-expired-banner">
          <AlertDescription className="text-orange-300 text-xs">
            Re-authorise Gmail to resume your email cadence.
          </AlertDescription>
        </Alert>
      )}

      {cadence.status === 'attachment_missing' && (
        <div data-testid="attachment-missing-notice" className="flex items-center gap-2 text-xs text-[#475569]">
          <Spinner className="size-3" />
          Awaiting resume PDF — Day 1 will send automatically once available.
        </div>
      )}
    </div>
  )
}
