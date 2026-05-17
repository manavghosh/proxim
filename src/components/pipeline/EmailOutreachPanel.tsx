'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { approveCadence, overrideEmail } from '@/lib/api'
import { EmailDraftCard } from './EmailDraftCard'
import type { EmailCadenceSummary, EmailDraftSummary } from '@/types/candidate'

interface Props {
  cadence: EmailCadenceSummary
  candidateId: string
  onCadenceUpdated: (c: EmailCadenceSummary) => void
}

const DAY_LABELS: Record<number, string> = { 1: 'Day 1', 3: 'Day 3', 7: 'Day 7' }
const DAY_SUBLABELS: Record<number, string> = {
  1: 'Intro',
  3: 'Value add',
  7: 'Gentle close',
}

export function EmailOutreachPanel({ cadence: initialCadence, candidateId, onCadenceUpdated }: Props) {
  const [cadence, setCadence] = useState(initialCadence)
  const [isApproving, setIsApproving] = useState(false)
  const [isOverriding, setIsOverriding] = useState(false)
  const [drafts, setDrafts] = useState<EmailDraftSummary[]>(initialCadence.drafts)
  const [activeTab, setActiveTab] = useState('1')

  function handleDraftUpdated(updated: EmailDraftSummary) {
    setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d))
  }

  async function handleApprove() {
    setIsApproving(true)
    try {
      const result = await approveCadence(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status, approvedAt: result.approvedAt, drafts }
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

  const showDraftTabs = (cadence.status === 'pending_approval' || cadence.status === 'active') && drafts.length > 0

  return (
    <div data-testid="email-outreach-panel" className="space-y-3">
      <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Email Outreach</p>

      {/* ── Draft tabs — pending_approval + active ── */}
      {showDraftTabs && (
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              {drafts.map(d => (
                <TabsTrigger key={d.id} value={String(d.dayNumber)} className="flex-1 flex-col gap-0 py-2">
                  <span className="text-[11px] font-semibold">{DAY_LABELS[d.dayNumber]}</span>
                  <span className="text-[9px] opacity-60">{DAY_SUBLABELS[d.dayNumber]}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {drafts.map(d => (
              <TabsContent key={d.id} value={String(d.dayNumber)} forceMount
                className={String(d.dayNumber) !== activeTab ? 'hidden' : ''}>
                <EmailDraftCard
                  draft={d}
                  cadenceId={cadence.id}
                  candidateId={candidateId}
                  onDraftUpdated={handleDraftUpdated}
                />
              </TabsContent>
            ))}
          </Tabs>

          {cadence.status === 'pending_approval' && (
            <Button
              onClick={handleApprove}
              isLoading={isApproving}
              data-testid="approve-cadence-btn"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Approve & Send Day 1 Now
            </Button>
          )}
        </>
      )}

      {/* ── Low confidence ── */}
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

      {/* ── Terminal / status states ── */}
      {cadence.status === 'email_not_found' && (
        <p className="text-xs text-[#475569]">No email found for this company domain.</p>
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
            Day 1 bounced — Day 3 and Day 7 cancelled.
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
          Awaiting resume PDF — Day 1 will send once available.
        </div>
      )}
    </div>
  )
}
