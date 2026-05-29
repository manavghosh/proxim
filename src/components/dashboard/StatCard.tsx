import { Card } from '@/components/ui/card'

interface StatCardProps {
  label: string
  value: string
  sub: string
  dotColor?: string
}

export function StatCard({ label, value, sub, dotColor }: StatCardProps) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-medium text-primary tracking-wide mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold text-foreground mb-1">{value}</p>
      <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
        {dotColor && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: dotColor }}
          />
        )}
        {sub}
      </p>
    </Card>
  )
}
