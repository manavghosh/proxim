'use client'

import { Badge } from '@/components/ui/badge'
import { extractStrengthsAndRisks } from '@/lib/score-helpers'

type Score10D = Record<string, unknown>

export function StrengthRiskChips({ score10d }: { score10d: Score10D | null }) {
  const { strengths, risks } = extractStrengthsAndRisks(score10d as Parameters<typeof extractStrengthsAndRisks>[0])

  if (strengths.length === 0 && risks.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {strengths.map(s => (
        <Badge
          key={s.name}
          variant="outline"
          className="text-[10px] border-teal-700 text-teal-400 bg-teal-950/40"
        >
          {s.name} · {s.score.toFixed(1)}
        </Badge>
      ))}
      {risks.map(r => (
        <Badge
          key={r.name}
          variant="outline"
          className="text-[10px] border-amber-700 text-amber-400 bg-amber-950/40"
        >
          {r.name} · {r.score.toFixed(1)}
        </Badge>
      ))}
    </div>
  )
}
