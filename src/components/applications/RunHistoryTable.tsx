'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DownloadIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import type { PipelineRunSummary } from '@/types/candidate'

interface RunHistoryTableProps {
  runs: PipelineRunSummary[]
  inProgress: PipelineRunSummary[]
  total: number
  page: number
  totalPages: number
  loading: boolean
  onPageChange: (page: number) => void
  onExport: () => void
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function RunHistoryTable({
  runs,
  inProgress,
  total,
  page,
  totalPages,
  loading,
  onPageChange,
  onExport,
}: RunHistoryTableProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-foreground font-semibold text-sm">
          Run History
          {total > 0 && <span className="text-muted-foreground font-normal ml-2 text-xs">({total} runs)</span>}
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] border-border text-muted-foreground hover:text-foreground gap-1"
          onClick={onExport}
        >
          <DownloadIcon className="w-3 h-3" />
          Export CSV
        </Button>
      </div>

      {/* In-progress runs */}
      {inProgress.length > 0 && (
        <div className="space-y-2">
          {inProgress.map(run => (
            <div key={run.id} className="flex items-center gap-3 px-3 py-2 bg-card border border-border rounded-lg">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
              <span className="text-[11px] text-muted-foreground">Run started {formatDateTime(run.startedAt)}</span>
              <Badge className="text-[10px] bg-blue-500/20 text-blue-300 border-blue-500/30 ml-auto">Running</Badge>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 rounded bg-card" />)}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground text-sm">No AI Agent runs yet — start the pipeline from the Dashboard.</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide">Start Time</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide">Duration</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Discovered</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">A/B Grade</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Resumes</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Emails Sent</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Replies</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(run => (
                  <TableRow key={run.id} className="border-border hover:bg-card/50">
                    <TableCell className="text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-2">
                        {run.status === 'failed' && (
                          <Badge variant="destructive" className="text-[9px] h-4 px-1.5">Failed</Badge>
                        )}
                        {formatDateTime(run.startedAt)}
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{formatDuration(run.durationSeconds)}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground text-right">{run.jobsDiscovered}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground text-right">{run.abGradeCount}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground text-right">{run.resumesGenerated}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground text-right">{run.emailsSent}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground text-right">{run.repliesReceived}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0 border-border text-muted-foreground"
                  onClick={() => onPageChange(page - 1)}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0 border-border text-muted-foreground"
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
