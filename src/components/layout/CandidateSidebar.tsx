'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Workflow, Send, Settings, ChevronLeft } from 'lucide-react'

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
          ? 'bg-[#0d1f3c] text-[#93c5fd] border border-[#1d4ed8]'
          : 'text-[#64748b] hover:bg-[#0d1829] hover:text-[#94a3b8]'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {soon && <span className="text-[10px] text-[#334155] font-medium">soon</span>}
    </Link>
  )
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export function CandidateSidebar({
  candidateId,
  candidateName,
}: {
  candidateId: string
  candidateName: string
}) {
  const pathname = usePathname()
  const base = `/candidates/${candidateId}`

  const NAV_MAIN = [
    { href: `${base}/dashboard`,    label: 'Dashboard',    icon: LayoutDashboard },
    { href: `${base}/pipeline`,     label: 'Pipeline',     icon: Workflow },
    { href: `${base}/applications`, label: 'Applications', icon: Send },
  ]
  const NAV_ACCOUNT = [
    { href: `${base}/settings`, label: 'Settings', icon: Settings },
  ]

  return (
    <aside className="w-[220px] bg-[#060d1f] border-r border-[#1e2d4a] flex flex-col flex-shrink-0 h-screen">
      {/* Logo + back */}
      <div className="px-4 py-5 border-b border-[#0d1829]">
        <Link
          href="/"
          aria-label="Proxim — back to all candidates"
          className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">P</span>
          </div>
          <div className="text-[13px] font-bold text-[#f1f5f9] tracking-widest flex-1">PROXIM</div>
        </Link>
        <Link
          href="/"
          className="mt-3 flex items-center gap-1 text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
          All Candidates
        </Link>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">Main</p>
        {NAV_MAIN.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
          />
        ))}
        <div className="pt-3">
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">Account</p>
          {NAV_ACCOUNT.map((item) => (
            <NavItem key={item.href} {...item} active={pathname === item.href} />
          ))}
        </div>
      </nav>

      {/* Candidate footer */}
      <div className="px-2.5 py-3 border-t border-[#0d1829]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-[#0d1829] cursor-pointer transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-700 to-indigo-700 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{initials(candidateName)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[#cbd5e1] truncate">{candidateName}</p>
            <p className="text-[9px] text-[#475569]">Candidate</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
