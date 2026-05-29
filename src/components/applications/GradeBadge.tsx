import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { GRADE_COLOR, GRADE_BG } from '@/lib/grade-colors'

interface GradeBadgeProps {
  grade: string | null | undefined
  /**
   * 'solid' — filled circular chip (white on grade colour), used in the
   *   Applications job cards.
   * 'soft'  — tinted outline pill (grade colour on translucent bg), used in the
   *   Pipeline review cards.
   */
  variant?: 'solid' | 'soft'
  className?: string
}

/**
 * Single source of truth for the grade (A–F) badge. Colours are derived from
 * lib/grade-colors.ts so chart, filter and every badge agree.
 */
export function GradeBadge({ grade, variant = 'solid', className }: GradeBadgeProps) {
  if (!grade) return null
  const color = GRADE_COLOR[grade] ?? GRADE_COLOR.F

  if (variant === 'soft') {
    return (
      <Badge
        variant="outline"
        data-testid="grade-badge"
        className={cn('text-[11px] font-bold px-2 py-0.5 border-transparent', className)}
        style={{ color, backgroundColor: GRADE_BG[grade] ?? GRADE_BG.F }}
      >
        {grade}
      </Badge>
    )
  }

  return (
    <Badge
      data-testid="grade-badge"
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold shrink-0 text-white border-transparent',
        className
      )}
      style={{ backgroundColor: color }}
    >
      {grade}
    </Badge>
  )
}
