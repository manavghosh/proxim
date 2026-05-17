'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { getCV } from '@/lib/api'
import type { ParseStatus } from '@/types/candidate'

interface ParseStatusBadgeProps {
  initialStatus: ParseStatus
  candidateId?: string
}

const LABELS: Record<ParseStatus, string> = {
  pending: 'Pending parse',
  parsing: 'Parsing CV…',
  ready: 'Profile ready',
  failed: 'Parse failed',
}

const VARIANTS: Record<ParseStatus, 'secondary' | 'default' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  parsing: 'outline',
  ready: 'default',
  failed: 'destructive',
}

const POLL_MS = 3000

export function ParseStatusBadge({ initialStatus, candidateId }: ParseStatusBadgeProps) {
  const [status, setStatus] = useState<ParseStatus>(initialStatus)

  // Keep the badge in sync when the parent re-renders with a new status —
  // e.g. after a Re-parse round-trip flips parseStatus from 'failed' back to
  // 'parsing' and then to 'ready'/'failed'. Without this the initial state
  // sticks for the lifetime of the component.
  useEffect(() => {
    setStatus(initialStatus)
  }, [initialStatus])

  useEffect(() => {
    if (!candidateId || status === 'ready' || status === 'failed') return
    const id = setInterval(async () => {
      try {
        const candidate = await getCV(candidateId)
        setStatus(candidate.parseStatus)
      } catch {
        // silent — keep polling
      }
    }, POLL_MS)
    return () => clearInterval(id)
  }, [status, candidateId])

  return (
    <Badge variant={VARIANTS[status]} className="gap-1.5">
      {status === 'parsing' && (
        <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
      )}
      {LABELS[status]}
    </Badge>
  )
}
