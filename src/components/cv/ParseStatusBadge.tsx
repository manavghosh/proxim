'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { getCV } from '@/lib/api'
import type { ParseStatus } from '@/types/candidate'

interface ParseStatusBadgeProps {
  initialStatus: ParseStatus
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

export function ParseStatusBadge({ initialStatus }: ParseStatusBadgeProps) {
  const [status, setStatus] = useState<ParseStatus>(initialStatus)

  useEffect(() => {
    if (status === 'ready' || status === 'failed') return
    const id = setInterval(async () => {
      try {
        const candidate = await getCV()
        setStatus(candidate.parseStatus)
      } catch {
        // silent — keep polling
      }
    }, POLL_MS)
    return () => clearInterval(id)
  }, [status])

  return (
    <Badge variant={VARIANTS[status]} className="gap-1.5">
      {status === 'parsing' && (
        <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
      )}
      {LABELS[status]}
    </Badge>
  )
}
