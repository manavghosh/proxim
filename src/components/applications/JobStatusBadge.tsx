import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  JOB_STATUS_LABELS,
  JOB_STATUS_BADGE_CLASS,
  type JobLifecycleStatus,
} from '@/lib/job-status-helpers'

interface JobStatusBadgeProps {
  status: string | null | undefined
  className?: string
}

/** Single source of truth for the job lifecycle status badge. */
export function JobStatusBadge({ status, className }: JobStatusBadgeProps) {
  if (!status || !(status in JOB_STATUS_LABELS)) return null
  const s = status as JobLifecycleStatus
  return (
    <Badge className={cn('text-[10px] h-5 px-1.5', JOB_STATUS_BADGE_CLASS[s], className)}>
      {JOB_STATUS_LABELS[s]}
    </Badge>
  )
}
