'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Workflow, Send, Archive, Settings, ChevronLeft } from 'lucide-react'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

function NavItem({
  href,
  label,
  icon: Icon,
  soon,
  active,
}: {
  href: string
  label: string
  icon: LucideIcon
  soon?: boolean
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? 'bg-card text-primary border border-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {soon && <span className="text-xs text-muted-foreground/70 font-medium">soon</span>}
    </Link>
  )
}

export function CandidateSidebar({
  candidateId,
  candidateName,
  avatarData,
}: {
  candidateId: string
  candidateName: string
  avatarData?: string | null
}) {
  const pathname = usePathname()
  const base = `/candidates/${candidateId}`

  const NAV_MAIN = [
    { href: `${base}/dashboard`,    label: 'Dashboard',    icon: LayoutDashboard },
    { href: `${base}/pipeline`,     label: 'Scorecard',    icon: Workflow },
    { href: `${base}/applications`, label: 'Applications', icon: Send },
    { href: `${base}/archived`,     label: 'Archived',     icon: Archive },
  ]
  const NAV_ACCOUNT = [
    { href: `${base}/settings`, label: 'Settings', icon: Settings },
  ]

  return (
    <aside className="w-[220px] bg-background border-r border-border flex flex-col flex-shrink-0 h-screen">
      {/* Logo + back */}
      <div className="px-4 py-5 border-b border-border">
        <Link
          href="/"
          aria-label="Proxim — back to all candidates"
          className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">P</span>
          </div>
          <div className="text-[13px] font-bold text-foreground tracking-widest flex-1">PROXIM</div>
        </Link>
        <Link
          href="/"
          className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
          All Candidates
        </Link>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        <p className="text-[10px] font-semibold text-muted-foreground/70 tracking-widest uppercase px-2 pb-1.5">Main</p>
        {NAV_MAIN.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
          />
        ))}
        <div className="pt-3">
          <p className="text-[10px] font-semibold text-muted-foreground/70 tracking-widest uppercase px-2 pb-1.5">Account</p>
          {NAV_ACCOUNT.map((item) => (
            <NavItem key={item.href} {...item} active={pathname === item.href} />
          ))}
        </div>
      </nav>

      {/* Candidate footer */}
      <div className="px-2.5 py-3 border-t border-border">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted cursor-pointer transition-colors">
          <CandidateAvatar name={candidateName} avatarData={avatarData} size="md" className="flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{candidateName}</p>
            <p className="text-[10px] text-muted-foreground">Candidate</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
