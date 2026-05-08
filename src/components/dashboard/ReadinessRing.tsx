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
  const ringColor = readiness.ready ? '#10b981' : '#f59e0b'

  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-semibold text-[#e2e8f0]">
          Pipeline Readiness
        </h2>
        <Link
          href={`/candidates/${candidateId}/settings`}
          className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
        >
          Go to Settings →
        </Link>
      </div>

      <div className="flex items-center gap-6">
        {/* SVG ring */}
        <div className="relative flex-shrink-0 w-[90px] h-[90px]">
          <svg width="90" height="90" viewBox="0 0 90 90">
            <circle
              cx="45" cy="45" r="36"
              fill="none" stroke="#1e3a5f" strokeWidth="8"
            />
            <circle
              cx="45" cy="45" r="36"
              fill="none"
              stroke={ringColor}
              strokeWidth="8"
              strokeDasharray={`${filled} ${CIRC}`}
              strokeDashoffset="0"
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-[#f1f5f9]">{pct}%</span>
            <span className="text-[9px] text-[#60a5fa]">ready</span>
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
                      ? 'bg-[#064e3b] text-[#34d399]'
                      : 'bg-[#1e2d4a] text-[#475569]'
                  }`}
                >
                  {done ? '✓' : '○'}
                </span>
                <span className={done ? 'text-[#6ee7b7]' : 'text-[#94a3b8]'}>
                  {criterion}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
