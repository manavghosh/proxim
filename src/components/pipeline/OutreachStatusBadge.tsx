'use client'

import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  OUTREACH_STATUS_LABELS,
  OUTREACH_STATUS_BADGE_VARIANT,
  isTransientOutreachStatus,
} from '@/lib/outreach-helpers'
import type { OutreachStatus } from '@/types/candidate'

interface Props {
  status: OutreachStatus | null
}

export function OutreachStatusBadge({ status }: Props) {
  if (!status) return null

  // Transient states show a spinner, not a badge
  if (isTransientOutreachStatus(status)) {
    return (
      <span
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
        data-testid="outreach-status-badge"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        {OUTREACH_STATUS_LABELS[status]}
      </span>
    )
  }

  const colourClass = OUTREACH_STATUS_BADGE_VARIANT[status]

  return (
    <span className="flex items-center gap-1.5" data-testid="outreach-status-badge">
      {status === 'notes_ready' && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
      )}
      <Badge
        variant="outline"
        className={`text-[10px] px-1.5 py-0 border-0 font-normal ${colourClass}`}
      >
        {OUTREACH_STATUS_LABELS[status]}
      </Badge>
    </span>
  )
}
