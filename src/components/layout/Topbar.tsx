import type { ReactNode } from 'react'

interface TopbarProps {
  title: string
  actions?: ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  return (
    <header className="h-[52px] bg-background border-b border-border flex items-center px-6 gap-4 flex-shrink-0">
      <h1 className="text-sm font-semibold text-foreground">{title}</h1>
      {actions && <div className="ml-auto flex items-center gap-2.5">{actions}</div>}
    </header>
  )
}
