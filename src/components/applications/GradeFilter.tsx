'use client'

interface Props {
  value: 'A' | 'A+B' | 'all'
  onChange: (v: 'A' | 'A+B' | 'all') => void
  counts: { A: number; B: number; total: number }
}

const OPTIONS: Array<{ label: string; value: 'A' | 'A+B' | 'all' }> = [
  { label: 'A only', value: 'A' },
  { label: 'A + B',  value: 'A+B' },
  { label: 'All',    value: 'all' },
]

export function GradeFilter({ value, onChange, counts }: Props) {
  return (
    <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-border-strong text-foreground'
              : 'text-muted-foreground hover:text-muted-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
      <span className="ml-2 text-[10px] text-muted-foreground">
        {counts.A}A · {counts.B}B · {counts.total} shown
      </span>
    </div>
  )
}
