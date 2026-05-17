'use client'

import { Badge } from '@/components/ui/badge'
import { EMAIL_CADENCE_STATUS_LABELS, EMAIL_CADENCE_BADGE_VARIANT } from '@/lib/email-cadence-helpers'
import type { EmailCadenceStatus } from '@/types/candidate'

const TRANSIENT: EmailCadenceStatus[] = ['pending_discovery', 'discovering', 'generating']

interface Props {
  status: EmailCadenceStatus | null
}

export function EmailCadenceStatusBadge({ status }: Props) {
  if (status === null || TRANSIENT.includes(status)) return null

  const label = EMAIL_CADENCE_STATUS_LABELS[status]
  const variant = EMAIL_CADENCE_BADGE_VARIANT[status]

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="email-cadence-status-badge">
      {status === 'pending_approval' && (
        <span className="size-2 rounded-full bg-blue-500 animate-pulse" aria-hidden />
      )}
      <Badge className={variant}>{label}</Badge>
    </span>
  )
}
