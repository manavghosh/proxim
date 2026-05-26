'use client'

import { useState } from 'react'
import { ExternalLink, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { markDraftSent } from '@/lib/api'
import type { EmailDraftSummary } from '@/types/candidate'

const DAY_LABELS: Record<number, string> = { 1: 'Day 1', 3: 'Day 3', 7: 'Day 7' }
const DAY_SUBLABELS: Record<number, string> = { 1: 'Intro', 3: 'Value add', 7: 'Gentle close' }

interface Props {
  draft: EmailDraftSummary
  cadenceId: string
  candidateId: string
  hiringManagerEmail: string
  scheduledAt?: string | null
  onDraftSent: (draftId: string) => void
  onGmailOpened?: () => void
}

function formatDue(iso: string): { label: string; overdue: boolean } {
  const due = new Date(iso)
  const diffMs = due.getTime() - Date.now()
  const diffH = Math.floor(diffMs / 3600000)
  if (diffMs < 0) return {
    label: `Overdue — was due ${due.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`,
    overdue: true,
  }
  if (diffH < 24) return { label: `Due in ${diffH}h`, overdue: false }
  const diffD = Math.floor(diffH / 24)
  const remH = diffH % 24
  return { label: `Due in ${diffD}d ${remH}h`, overdue: false }
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
}

function buildGmailUrl(to: string, subject: string, bodyHtml: string): string {
  const body = htmlToPlainText(bodyHtml)
  return `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function ManualSendDraftCard({
  draft, cadenceId, candidateId, hiringManagerEmail, scheduledAt, onDraftSent, onGmailOpened,
}: Props) {
  const [gmailOpened, setGmailOpened] = useState(false)
  const [marking, setMarking]         = useState(false)

  const isAlreadySent = draft.status === 'sent' || draft.status === 'manually_sent'
  const dueInfo = scheduledAt ? formatDue(scheduledAt) : null

  async function handleMarkSent() {
    setMarking(true)
    try {
      await markDraftSent(cadenceId, draft.id, candidateId)
      onDraftSent(draft.id)
    } finally {
      setMarking(false)
    }
  }

  const gmailUrl = buildGmailUrl(hiringManagerEmail, draft.subject, draft.bodyHtml)

  if (isAlreadySent) {
    return (
      <Card className="border border-emerald-800/30 bg-emerald-950/10" data-testid={`manual-draft-day-${draft.dayNumber}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">
              {DAY_LABELS[draft.dayNumber]} — Sent
            </span>
          </div>
        </CardHeader>
        {draft.sentAt && (
          <CardContent className="pt-0 pb-2">
            <div data-testid="draft-send-status" className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#475569]">
              <span>✉ Sent {new Date(draft.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
              {draft.openDetectedAt
                ? <span>👁 Opened {new Date(draft.openDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                : <span className="text-[#334155]">Not opened yet</span>
              }
              {draft.clickDetectedAt && (
                <span>→ Clicked {new Date(draft.clickDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    )
  }

  return (
    <Card className="border border-[#1e2d4a]" data-testid={`manual-draft-day-${draft.dayNumber}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[#94a3b8]">{DAY_LABELS[draft.dayNumber]}</span>
            <span className="text-[9px] text-[#475569]">{DAY_SUBLABELS[draft.dayNumber]}</span>
          </div>
          {dueInfo && (
            <Badge className={`text-[10px] flex items-center gap-1 ${
              dueInfo.overdue
                ? 'bg-red-950/40 text-red-400 border-red-800/40'
                : 'bg-[#0d1829] text-[#64748b] border-[#1e2d4a]'
            }`}>
              {dueInfo.overdue
                ? <AlertTriangle className="w-2.5 h-2.5" />
                : <Clock className="w-2.5 h-2.5" />}
              {dueInfo.label}
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-[#475569] mt-0.5">{draft.subject}</p>
      </CardHeader>

      <CardContent className="space-y-2">
        <div
          className="text-xs text-[#94a3b8] prose prose-invert prose-sm max-w-none max-h-[120px] overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: draft.bodyHtml }}
        />

        <Button
          asChild
          size="sm"
          variant="outline"
          className="w-full text-xs border-blue-700/40 text-blue-400 hover:bg-blue-950/20 gap-1.5"
          data-testid={`open-gmail-day-${draft.dayNumber}`}
        >
          <a
            href={gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { setGmailOpened(true); onGmailOpened?.() }}
          >
            <ExternalLink className="w-3 h-3" />
            Open in Gmail →
          </a>
        </Button>

        {gmailOpened && (
          <Button
            size="sm"
            className="w-full text-xs bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
            onClick={handleMarkSent}
            isLoading={marking}
            data-testid={`mark-sent-day-${draft.dayNumber}`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Mark as Sent
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
