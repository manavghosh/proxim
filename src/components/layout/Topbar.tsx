interface TopbarProps {
  title: string
  actions?: React.ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  return (
    <header className="h-[52px] bg-[#0a1220] border-b border-[#1e2d4a] flex items-center px-6 gap-4 flex-shrink-0">
      <h1 className="text-sm font-semibold text-[#f1f5f9]">{title}</h1>
      {actions && <div className="ml-auto flex items-center gap-2.5">{actions}</div>}
    </header>
  )
}
