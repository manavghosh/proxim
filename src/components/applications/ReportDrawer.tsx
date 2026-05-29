'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { getJobReport } from '@/lib/api'

interface Props {
  jobId: string | null
  onClose: () => void
}

export function ReportDrawer({ jobId, onClose }: Props) {
  const [report, setReport]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!jobId) { setReport(null); return }
    setLoading(true)
    getJobReport(jobId)
      .then((r) => setReport(r.reportMd))
      .catch(() => setReport('Failed to load report.'))
      .finally(() => setLoading(false))
  }, [jobId])

  return (
    <Sheet open={!!jobId} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl bg-background border-l border-border overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-foreground text-sm font-semibold">Score Report</SheetTitle>
        </SheetHeader>
        {loading ? (
          <div className="px-6 space-y-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-4 rounded bg-card" />
            ))}
          </div>
        ) : (
          <pre className="px-6 pb-6 whitespace-pre-wrap text-xs font-mono text-muted-foreground leading-relaxed">
            {report ?? 'No report available.'}
          </pre>
        )}
      </SheetContent>
    </Sheet>
  )
}
