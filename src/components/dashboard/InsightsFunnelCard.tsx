'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import type { InsightsResponse, ArchetypeBreakdownRow } from '@/types/candidate'

interface Props {
  insights: InsightsResponse | null
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—'
  return `${Math.round(rate * 100)}%`
}

const FUNNEL_STAGES = [
  { key: 'discovered', label: 'Discovered' },
  { key: 'approved',   label: 'Approved'   },
  { key: 'day1Sent',   label: 'Sent'        },
  { key: 'opened',     label: 'Opened'      },
  { key: 'replied',    label: 'Replied'     },
  { key: 'callbacks',  label: 'Callback'    },
] as const

const RATE_CARDS = [
  { key: 'openRate',     label: 'Open rate'      },
  { key: 'replyRate',    label: 'Reply rate'      },
  { key: 'abGradeRate',  label: 'A/B grade mix'   },
  { key: 'callbackRate', label: 'Callback rate'   },
] as const

function ArchetypeTable({ rows }: { rows: ArchetypeBreakdownRow[] }) {
  if (rows.length < 2) return null
  return (
    <div className="mt-4">
      <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase mb-2">
        Archetype Reply Rates
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[#475569]">
            <th className="pb-1 font-normal">Archetype</th>
            <th className="pb-1 font-normal text-right">Sent</th>
            <th className="pb-1 font-normal text-right">Replied</th>
            <th className="pb-1 font-normal text-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.archetype} className="border-t border-[#1e2d4a]">
              <td className="py-1 text-[#94a3b8] truncate max-w-[140px]">{row.archetype}</td>
              <td className="py-1 text-right text-[#64748b]">{row.sent}</td>
              <td className="py-1 text-right text-[#64748b]">{row.replied}</td>
              <td className="py-1 text-right">
                {row.replyRate !== null && row.replyRate > 0 ? (
                  <Badge className="bg-amber-950/40 text-amber-400 border-amber-800/40 text-[9px] px-1.5 py-0">
                    {formatRate(row.replyRate)}
                  </Badge>
                ) : (
                  <span className="text-[#475569]">{formatRate(row.replyRate)}</span>
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
      <div className="rounded-xl border border-[#1e2d4a] bg-[#0d1f3c] p-4 space-y-3">
        <div className="animate-pulse h-3 w-32 rounded bg-[#1e2d4a]" />
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
    <div className="rounded-xl border border-[#1e2d4a] bg-[#0d1f3c] p-4 space-y-4">
      <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
        Outreach Insights
      </p>

      {/* Funnel row */}
      <div className="grid grid-cols-6 gap-2">
        {FUNNEL_STAGES.map(({ key, label }) => (
          <div key={key} className="flex flex-col items-center gap-1">
            <span className="text-lg font-bold text-[#e2e8f0] leading-none">
              {funnel[key]}
            </span>
            <span className="text-[9px] text-[#475569] text-center leading-tight">{label}</span>
          </div>
        ))}
      </div>

      {/* Rate cards */}
      <div className="grid grid-cols-4 gap-2">
        {RATE_CARDS.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-lg border border-[#1e2d4a] bg-[#0a1628] p-2 flex flex-col items-center gap-1"
            title={key === 'openRate' ? 'Open tracking may be blocked by some email clients — actual open rate may be higher' : undefined}
          >
            <span className={`text-sm font-semibold leading-none ${
              rates[key] === null ? 'text-[#475569]' : 'text-[#e2e8f0]'
            }`}>
              {formatRate(rates[key])}
            </span>
            <span className="text-[9px] text-[#475569] text-center leading-tight">{label}</span>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {isEmpty && (
        <p className="text-[11px] text-[#475569] italic text-center pt-1">
          Send your first email to see performance data.
        </p>
      )}

      {/* Archetype breakdown */}
      <ArchetypeTable rows={archetypeBreakdown} />
    </div>
  )
}
