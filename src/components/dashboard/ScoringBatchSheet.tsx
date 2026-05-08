'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getReadyToScoreGroups,
  scoreBatch,
  type PositionGroup,
  type ReadyToScoreResponse,
} from '@/lib/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidateId: string
  onScored: (pipelineJobId: string) => void
}

const TOKENS_PER_JOB_ESTIMATE = 3000

export function ScoringBatchSheet({ open, onOpenChange, candidateId, onScored }: Props) {
  const [data, setData] = useState<ReadyToScoreResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelected(new Set())
    getReadyToScoreGroups(candidateId)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load groups')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, candidateId])

  const groups = data?.groups ?? []

  const { selectedJobIds, selectedCount } = useMemo(() => {
    const ids: string[] = []
    for (const g of groups) {
      if (selected.has(g.position)) ids.push(...g.jobIds)
    }
    return { selectedJobIds: ids, selectedCount: ids.length }
  }, [groups, selected])

  const totalJobs = data?.totalJobs ?? 0
  const estTokens = selectedCount * TOKENS_PER_JOB_ESTIMATE

  function toggle(position: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(position)) next.delete(position)
      else next.add(position)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(groups.map((g) => g.position)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function submit() {
    if (selectedJobIds.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const { jobId } = await scoreBatch(candidateId, selectedJobIds)
      onScored(jobId)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to enqueue scoring batch')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-[#0d1829] border-[#1e2d4a] flex flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-[#1e2d4a]">
          <SheetTitle className="text-[#f1f5f9]">Select Scoring Batch</SheetTitle>
          <SheetDescription className="text-[#94a3b8]">
            {totalJobs > 0
              ? `${totalJobs} jobs ready. Pick the positions you want to score now — the rest stay queued for a later batch.`
              : 'No jobs are ready to score yet.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl bg-[#0d1f3c]" />
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-5 text-sm text-red-400">{error}</CardContent>
            </Card>
          ) : groups.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-[#94a3b8]">
                <p className="font-medium text-[#f1f5f9]">No jobs ready to score</p>
                <p className="mt-1 text-xs text-[#475569]">
                  Run the discovery pipeline first, then come back here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-xs text-[#94a3b8]">
                <span>{groups.length} position groups</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="h-7 text-[#94a3b8]"
                    onClick={selectAll}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="h-7 text-[#94a3b8]"
                    onClick={clearAll}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <ul className="space-y-2" data-slot="position-groups">
                {groups.map((g) => (
                  <PositionRow
                    key={g.position}
                    group={g}
                    selected={selected.has(g.position)}
                    onToggle={() => toggle(g.position)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="border-t border-[#1e2d4a] p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-[#94a3b8]">
            <span>
              {selectedCount} of {totalJobs} jobs selected
            </span>
            {selectedCount > 0 && (
              <span className="text-[#475569]">
                ~{estTokens.toLocaleString()} tokens est.
              </span>
            )}
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={selectedCount === 0 || submitting}
            isLoading={submitting}
            onClick={submit}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Queuing batch…
              </>
            ) : (
              `Score Selected (${selectedCount})`
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PositionRow({
  group,
  selected,
  onToggle,
}: {
  group: PositionGroup
  selected: boolean
  onToggle: () => void
}) {
  const subtitle =
    group.sampleCompanies.length > 0
      ? `${group.sampleCompanies.slice(0, 3).join(', ')}${group.count > group.sampleCompanies.length ? ' …' : ''}`
      : 'Various companies'

  return (
    <li data-position={group.position}>
      <Card
        className={`cursor-pointer transition-colors ${
          selected ? 'border-primary bg-primary/5' : ''
        }`}
        onClick={onToggle}
      >
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-[#f1f5f9]">{group.position}</p>
              <Badge variant={selected ? 'default' : 'secondary'} className="text-[10px]">
                {group.count}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#475569]">{subtitle}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={selected ? 'default' : 'outline'}
            aria-label={`Toggle ${group.position}`}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {selected ? 'Selected' : 'Select'}
          </Button>
        </CardContent>
      </Card>
    </li>
  )
}
