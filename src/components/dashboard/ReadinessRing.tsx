import Link from 'next/link'
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

  // SVG circle: r=36, circumference = 2π×36 ≈ 226.2
  const CIRC = 226.2
  const filled = (met / total) * CIRC

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-6">
        {/* SVG ring */}
        <div className="relative flex-shrink-0 w-[90px] h-[90px]">
          <svg width="90" height="90" viewBox="0 0 90 90">
            <circle
              cx="45" cy="45" r="36"
              fill="none" className="stroke-border" strokeWidth="8"
            />
            <circle
              cx="45" cy="45" r="36"
              fill="none"
              className={readiness.ready ? 'stroke-success' : 'stroke-warning'}
              strokeWidth="8"
              strokeDasharray={`${filled} ${CIRC}`}
              strokeDashoffset="0"
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-foreground">{pct}%</span>
            <span className="text-[9px] text-primary">ready</span>
          </div>
        </div>

        {/* Checklist */}
        <div className="flex flex-col gap-2.5 flex-1">
          {CRITERIA.map((criterion) => {
            const done = !readiness.missing.includes(criterion)
            return (
              <div key={criterion} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] flex-shrink-0 font-bold ${
                    done
                      ? 'bg-success/15 text-success'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {done ? '✓' : '○'}
                </span>
                <span className={done ? 'text-success' : 'text-muted-foreground'}>
                  {criterion}
                </span>
              </div>
            )
          })}
          <Link
            href={`/candidates/${candidateId}/settings`}
            className="text-[11px] text-primary hover:text-primary/80 transition-colors mt-1"
          >
            Go to Settings →
          </Link>
        </div>
      </div>
    </div>
  )
}
