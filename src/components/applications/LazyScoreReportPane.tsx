'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { MarkdownReport } from '@/components/ui/markdown-report'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getJobReport } from '@/lib/api'

interface Props {
  jobId: string
}

// Same inline-expand UX as the Pipeline page (`ScoreReportPane`) — but the
// Applications list endpoint doesn't ship `reportMd` with every row (the list
// can be large), so we lazy-load it from `/api/jobs/{jobId}/report` the first
// time the user opens the pane. After that it's cached in component state.
export function LazyScoreReportPane({ jobId }: Props) {
  const [open, setOpen] = useState(false)
  const [reportMd, setReportMd] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || reportMd !== null || loading) return
    setLoading(true)
    setError(null)
    getJobReport(jobId)
      .then((r) => setReportMd(r.reportMd ?? '_No report available._'))
      .catch(() => setError('Failed to load report'))
      .finally(() => setLoading(false))
  }, [open, jobId, reportMd, loading])

  return (
    <div className="mt-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((p) => !p)}
        className="text-[11px] text-muted-foreground hover:text-muted-foreground px-0 h-auto gap-1"
      >
        {open ? (
          <>Hide Report <ChevronUp className="w-3 h-3" /></>
        ) : (
          <>View Report <ChevronDown className="w-3 h-3" /></>
        )}
      </Button>

      {open && (
        <div className="mt-2 p-3 rounded-md bg-background border border-border max-h-80 overflow-y-auto">
          {loading && <p className="text-[11px] text-muted-foreground">Loading report…</p>}
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {reportMd && !loading && !error && <MarkdownReport content={reportMd} />}
        </div>
      )}
    </div>
  )
}
