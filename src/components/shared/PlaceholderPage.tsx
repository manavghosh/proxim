import Link from 'next/link'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
  icon: LucideIcon
  heading: string
  body: string
  ctaLabel: string
  ctaHref: string
}

export function PlaceholderPage({
  title,
  icon: Icon,
  heading,
  body,
  ctaLabel,
  ctaHref,
}: PlaceholderPageProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title={title} />
      <main className="flex-1 flex items-center justify-center bg-[#0d1829]">
        <div className="text-center max-w-md space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-[#0d1f3c] border border-[#1e3a5f] flex items-center justify-center mx-auto">
            <Icon className="w-7 h-7 text-[#334155]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-[#e2e8f0]">{heading}</h2>
            <p className="text-sm text-[#64748b] leading-relaxed">{body}</p>
          </div>
          <Button asChild variant="outline" size="sm" className="border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
