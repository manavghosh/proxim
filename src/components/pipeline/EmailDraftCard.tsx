'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { updateDraft } from '@/lib/api'
import { EMAIL_DRAFT_STATUS_LABELS } from '@/lib/email-cadence-helpers'
import type { EmailDraftSummary } from '@/types/candidate'

const DAY_LABELS: Record<number, string> = { 1: 'Day 1', 3: 'Day 3', 7: 'Day 7' }

interface Props {
  draft: EmailDraftSummary
  cadenceId: string
  candidateId: string
  onDraftUpdated: (d: EmailDraftSummary) => void
}

export function EmailDraftCard({ draft, cadenceId, candidateId, onDraftUpdated }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [editedBody, setEditedBody] = useState(draft.bodyHtml)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    setIsSaving(true)
    try {
      const updated = await updateDraft(cadenceId, draft.id, candidateId, editedBody)
      onDraftUpdated(updated)
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const displayHtml = showOriginal ? draft.originalBodyHtml : draft.bodyHtml

  return (
    <Card data-testid={`email-draft-card-day-${draft.dayNumber}`} className="border border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {DAY_LABELS[draft.dayNumber] ?? `Day ${draft.dayNumber}`}
          </span>
          <div className="flex items-center gap-1.5">
            {draft.openDetectedAt && (
              <Badge className="bg-emerald-100 text-emerald-800 text-[10px]" data-testid="draft-open-badge">
                Opened
              </Badge>
            )}
            {draft.clickDetectedAt && (
              <Badge className="bg-blue-100 text-blue-800 text-[10px]" data-testid="draft-click-badge">
                Clicked
              </Badge>
            )}
            <Badge className="text-[10px]" data-testid="draft-status-badge">
              {EMAIL_DRAFT_STATUS_LABELS[draft.status] ?? draft.status}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{draft.subject}</p>
      </CardHeader>

      <CardContent className="space-y-2">
        {isEditing ? (
          <>
            <Textarea
              data-testid="draft-edit-textarea"
              value={editedBody}
              onChange={e => setEditedBody(e.target.value)}
              rows={6}
              className="text-xs"
            />
            <div className="flex gap-2">
              {isSaving ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <Button size="sm" onClick={handleSave} data-testid="draft-save-btn">
                  Save
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <div
              className="text-xs text-muted-foreground prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: displayHtml }}
            />
            {showOriginal && (
              <p className="text-[10px] text-muted-foreground italic">Showing original generated version</p>
            )}
            <div className="flex gap-2">
              {!['sent', 'sending', 'cancelled', 'bounced'].includes(draft.status) && (
                <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} data-testid="draft-edit-btn">
                  Edit
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowOriginal(v => !v)}
                data-testid="draft-original-toggle"
              >
                {showOriginal ? 'Show Edited' : 'Show Original'}
              </Button>
            </div>
            {draft.sentAt && (
              <div data-testid="draft-send-status" className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                <span>✉ Sent {new Date(draft.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                {draft.openDetectedAt
                  ? <span>👁 Opened {new Date(draft.openDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                  : <span className="text-muted-foreground">Not opened yet</span>
                }
                {draft.clickDetectedAt && (
                  <span>→ Clicked {new Date(draft.clickDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
