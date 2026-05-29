'use client'

import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface DashboardSectionProps {
  title: string
  badge?: React.ReactNode
  defaultOpen?: boolean
  storageKey?: string
  children: React.ReactNode
}

export function DashboardSection({
  title,
  badge,
  defaultOpen = true,
  storageKey,
  children,
}: DashboardSectionProps) {
  const [open, setOpen] = useState(() => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = localStorage.getItem(`ds-${storageKey}`)
      return saved !== null ? saved === 'true' : defaultOpen
    }
    return defaultOpen
  })

  function toggle(next: boolean) {
    setOpen(next)
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(`ds-${storageKey}`, String(next))
    }
  }

  return (
    <Collapsible open={open} onOpenChange={toggle}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between px-1 py-1 mb-2 group cursor-pointer">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase">
              {title}
            </span>
            {badge}
          </div>
          <ChevronDownIcon
            className={`w-3.5 h-3.5 text-muted-foreground group-hover:text-muted-foreground transition-all duration-200 ${
              open ? '' : '-rotate-90'
            }`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
