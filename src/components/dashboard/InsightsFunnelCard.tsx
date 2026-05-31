'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import type { InsightsResponse, ArchetypeBreakdownRow } from '@/types/candidate'

interface Props {
  insights: InsightsResponse | null
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—'
  return `${Math.round(rate * 100)}%`
}

const FUNNEL_STAGES = [
  { key: 'discovered', label: 'Discovered', desc: 'Every role the agent found and scored for you — the full size of your pipeline.' },
  { key: 'approved',   label: 'Approved',   desc: 'Roles that cleared scoring and were shortlisted to pursue (résumé tailoring + outreach).' },
  { key: 'day1Sent',   label: 'Sent',       desc: 'Companies where your first outreach email has actually gone out (counted once per company).' },
  { key: 'opened',     label: 'Opened',     desc: 'Sent emails the recipient opened. Some mail apps block open tracking, so the real number may be higher.' },
  { key: 'replied',    label: 'Replied',    desc: 'Companies where the contact wrote back — actual human responses.' },
  { key: 'callbacks',  label: 'Callback',   desc: 'Jobs that turned into an interview invite — the finish line.' },
] as const

const RATE_CARDS = [
  { key: 'openRate',     label: 'Open rate',     desc: 'Opened ÷ Sent. Share of your emails that were opened. May read low if a mail app blocks open tracking.' },
  { key: 'replyRate',    label: 'Reply rate',    desc: 'Replied ÷ Sent. Share of emails that earned a reply — the key sign your outreach is landing.' },
  { key: 'abGradeRate',  label: 'A/B grade mix', desc: 'A/B-graded ÷ Approved. Share of your shortlisted roles that are strong (grade A or B) matches — a pipeline-quality gauge.' },
  { key: 'callbackRate', label: 'Callback rate', desc: 'Callbacks ÷ Approved. Share of pursued roles that became interviews — your overall success rate.' },
] as const

function ArchetypeTable({ rows }: { rows: ArchetypeBreakdownRow[] }) {
  if (rows.length < 2) return null
  return (
    <div className="mt-4">
      <p className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase mb-2">
        Archetype Reply Rates
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-normal">Archetype</th>
            <th className="pb-1 font-normal text-right">Sent</th>
            <th className="pb-1 font-normal text-right">Replied</th>
            <th className="pb-1 font-normal text-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.archetype} className="border-t border-border">
              <td className="py-1 text-muted-foreground truncate max-w-[140px]">{row.archetype}</td>
              <td className="py-1 text-right text-muted-foreground">{row.sent}</td>
              <td className="py-1 text-right text-muted-foreground">{row.replied}</td>
              <td className="py-1 text-right">
                {row.replyRate !== null && row.replyRate > 0 ? (
                  <Badge className="bg-amber-950/40 text-amber-400 border-amber-800/40 text-[9px] px-1.5 py-0">
                    {formatRate(row.replyRate)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">{formatRate(row.replyRate)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function InsightsFunnelCard({ insights }: Props) {
  if (insights === null) {
    return (
      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <div className="animate-pulse h-3 w-32 rounded bg-border" />
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const { funnel, rates, archetypeBreakdown } = insights
  const isEmpty = funnel.day1Sent === 0

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-xl border border-border bg-background p-4 space-y-4">
        {/* Funnel row */}
        <div className="grid grid-cols-6 gap-2">
          {FUNNEL_STAGES.map(({ key, label, desc }) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <div className="flex flex-col items-center gap-1 cursor-help rounded-md px-1 py-1 transition-colors hover:bg-accent">
                  <span className="text-lg font-bold text-foreground leading-none">
                    {funnel[key]}
                  </span>
                  <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>{desc}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Rate cards */}
        <div className="grid grid-cols-4 gap-2">
          {RATE_CARDS.map(({ key, label, desc }) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <div className="rounded-lg border border-border bg-background p-2 flex flex-col items-center gap-1 cursor-help transition-colors hover:border-border-strong">
                  <span className={`text-sm font-semibold leading-none ${
                    rates[key] === null ? 'text-muted-foreground' : 'text-foreground'
                  }`}>
                    {formatRate(rates[key])}
                  </span>
                  <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>{desc}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Empty state */}
        {isEmpty && (
          <p className="text-[11px] text-muted-foreground italic text-center pt-1">
            Send your first email to see performance data.
          </p>
        )}

        {/* Archetype breakdown */}
        <ArchetypeTable rows={archetypeBreakdown} />
      </div>
    </TooltipProvider>
  )
}
