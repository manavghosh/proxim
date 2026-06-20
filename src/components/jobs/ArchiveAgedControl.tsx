'use client'

import { useState } from 'react'
import { Archive } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { archiveAgedJobs } from '@/lib/api'

type Days = 30 | 60 | 90

/**
 * Bulk "archive postings older than N days" control. Lives in the Scorecard and
 * Applications headers. Choosing an age opens a confirm dialog pre-populated with
 * a dry-run count, then archives the eligible (inactive) jobs on confirm.
 */
export function ArchiveAgedControl({
  candidateId,
  onArchived,
  onError,
}: {
  candidateId: string
  onArchived: (count: number) => void
  onError?: (message: string) => void
}) {
  const [days, setDays] = useState<Days | null>(null)
  const [open, setOpen] = useState(false)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSelect = async (value: string) => {
    const d = Number(value) as Days
    setDays(d)
    setPreviewCount(null)
    setOpen(true)
    try {
      const res = await archiveAgedJobs(candidateId, d, true)
      setPreviewCount(res.count)
    } catch {
      setPreviewCount(0)
      onError?.('Failed to count aged jobs')
    }
  }

  const handleConfirm = async () => {
    if (!days) return
    setSubmitting(true)
    try {
      const res = await archiveAgedJobs(candidateId, days, false)
      onArchived(res.count)
      setOpen(false)
      setDays(null)
    } catch {
      onError?.('Failed to archive aged jobs')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* `value` is intentionally uncontrolled (always "") so the same age can be
          re-selected to re-open the dialog. */}
      <Select value="" onValueChange={handleSelect}>
        <SelectTrigger size="sm" className="text-[11px] gap-1.5" aria-label="Archive aged jobs" data-testid="archive-aged-trigger">
          <Archive className="w-3.5 h-3.5" />
          <SelectValue placeholder="Archive aged…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="30">Older than 30 days</SelectItem>
          <SelectItem value="60">Older than 60 days</SelectItem>
          <SelectItem value="90">Older than 90 days</SelectItem>
        </SelectContent>
      </Select>

      <AlertDialog open={open} onOpenChange={(o) => { if (!submitting) setOpen(o) }}>
        <AlertDialogContent data-testid="archive-aged-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive jobs older than {days} days?</AlertDialogTitle>
            <AlertDialogDescription>
              {previewCount === null
                ? 'Counting eligible jobs…'
                : previewCount === 0
                  ? `No inactive jobs have a posting date older than ${days} days. Active applications (approved, resume-ready, submitted, or with an interview) and jobs without a posting date are never swept.`
                  : `This will archive ${previewCount} inactive job${previewCount === 1 ? '' : 's'} whose posting date is older than ${days} days. Active applications and jobs without a posting date are skipped. You can restore them anytime from the Archived screen.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirm() }}
              disabled={submitting || previewCount === null || previewCount === 0}
              data-testid="archive-aged-confirm"
            >
              {submitting ? 'Archiving…' : `Archive ${previewCount ?? ''}`.trim()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
