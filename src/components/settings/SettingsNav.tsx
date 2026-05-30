'use client'

import type { LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SettingsSectionMeta {
  id: string
  label: string
  icon: LucideIcon
}

interface SettingsNavProps {
  sections: SettingsSectionMeta[]
  activeId: string
  onSelect: (id: string) => void
  setupDone: number
  setupTotal: number
}

export function SettingsNav({ sections, activeId, onSelect, setupDone, setupTotal }: SettingsNavProps) {
  const complete = setupDone >= setupTotal
  const pct = setupTotal > 0 ? Math.round((setupDone / setupTotal) * 100) : 0

  return (
    <nav className="sticky top-6 flex flex-col gap-1 self-start">
      {sections.map((s) => {
        const Icon = s.icon
        const active = s.id === activeId
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-card text-foreground font-medium border border-border-strong'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent',
            )}
          >
            <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-primary' : '')} />
            {s.label}
          </button>
        )
      })}

      {/* Setup progress */}
      <div className="mt-4 rounded-lg border border-border-strong bg-card p-3">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase">
            Setup
          </p>
          {complete ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
              <Check className="w-3 h-3" /> Complete
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">{setupDone} / {setupTotal}</span>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
          <div
            className={cn('h-full rounded-full transition-all', complete ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </nav>
  )
}
