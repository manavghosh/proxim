import * as React from 'react'
import { cn } from '@/lib/utils'

interface ProgressRingProps {
  /** 0–100 */
  value: number
  /** outer diameter in px */
  size?: number
  strokeWidth?: number
  /** Tailwind stroke-* class for the filled arc (e.g. "stroke-success") */
  colorClass?: string
  /** Tailwind stroke-* class for the track */
  trackClass?: string
  className?: string
  /** centred content (percentage label, icon, …) */
  children?: React.ReactNode
}

export function ProgressRing({
  value,
  size = 90,
  strokeWidth = 8,
  colorClass = 'stroke-primary',
  trackClass = 'stroke-border',
  className,
  children,
}: ProgressRingProps) {
  const c = 45 // center within the fixed 90-unit viewBox (scaled by size)
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(100, value)) / 100) * circumference

  return (
    <div
      className={cn('relative flex-shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 90 90">
        <circle cx={c} cy={c} r={radius} fill="none" className={trackClass} strokeWidth={strokeWidth} />
        <circle
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          className={colorClass}
          strokeWidth={strokeWidth}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px', transition: 'stroke-dasharray 500ms ease' }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>}
    </div>
  )
}
