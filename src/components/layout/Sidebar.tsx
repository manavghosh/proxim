'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Workflow,
  Send,
  Settings,
} from 'lucide-react'

const USER_NAME = 'Manav Ghosh'
const USER_ROLE = 'CAIO candidate'

const NAV_MAIN = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: Workflow, soon: true },
  { href: '/applications', label: 'Applications', icon: Send, soon: true },
]

const NAV_ACCOUNT = [
  { href: '/settings', label: 'Settings', icon: Settings },
]

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
      {soon && (
        <span className="text-[10px] text-[#334155] font-medium">soon</span>
      )}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-[220px] bg-[#060d1f] border-r border-[#1e2d4a] flex flex-col flex-shrink-0 h-screen">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#0d1829]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">P</span>
          </div>
          <div>
            <div className="text-[13px] font-bold text-[#f1f5f9] tracking-widest">
              PROXIM
            </div>
            <div className="text-[9px] text-[#334155]">v0.1 · MVP</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">
          Main
        </p>
        {NAV_MAIN.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
          />
        ))}

        <div className="pt-3">
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">
            Account
          </p>
          {NAV_ACCOUNT.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname === item.href}
            />
          ))}
        </div>
      </nav>

      {/* User footer */}
      <div className="px-2.5 py-3 border-t border-[#0d1829]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-[#0d1829] cursor-pointer transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-700 to-indigo-700 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">M</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[#cbd5e1] truncate">
              {USER_NAME}
            </p>
            <p className="text-[9px] text-[#475569]">{USER_ROLE}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
