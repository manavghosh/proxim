import Link from 'next/link'
import { Check, Circle, ArrowRight } from 'lucide-react'
import { ProgressRing } from '@/components/ui/progress-ring'
import type { PipelineReadiness } from '@/types/candidate'

interface ReadinessRingProps {
  readiness: PipelineReadiness
  candidateId: string
}

const CRITERIA = [
  'Upload and save your CV',
  'Set your target seniority level',
  'Set your geographic preference',
]

export function ReadinessRing({ readiness, candidateId }: ReadinessRingProps) {
  const total = CRITERIA.length
  const met = total - readiness.missing.length
  const pct = Math.round((met / total) * 100)

  return (
    <div className="bg-background border border-border rounded-xl p-5">
      <div className="flex items-center gap-6">
        <ProgressRing
          value={pct}
          colorClass={readiness.ready ? 'stroke-success' : 'stroke-warning'}
        >
          <span className="text-lg font-bold text-foreground">{pct}%</span>
          <span className="text-[9px] text-primary">ready</span>
        </ProgressRing>

        {/* Checklist */}
        <div className="flex flex-col gap-2.5 flex-1">
          {CRITERIA.map((criterion) => {
            const done = !readiness.missing.includes(criterion)
            return (
              <div key={criterion} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={`w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0 ${
                    done
                      ? 'bg-success/15 text-success'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {done ? <Check className="w-3 h-3" /> : <Circle className="w-2.5 h-2.5" />}
                </span>
                <span className={done ? 'text-success' : 'text-muted-foreground'}>
                  {criterion}
                </span>
              </div>
            )
          })}
          <Link
            href={`/candidates/${candidateId}/settings`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors mt-1"
          >
            Go to Settings <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}
