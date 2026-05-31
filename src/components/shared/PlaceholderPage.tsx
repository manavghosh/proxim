'use client'

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
      <main className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-card border border-border-strong flex items-center justify-center mx-auto">
            <Icon className="w-7 h-7 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </div>
          <Button asChild variant="outline" size="sm" className="border-border-strong text-primary hover:bg-card">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
