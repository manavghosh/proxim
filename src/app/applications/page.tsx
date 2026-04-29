'use client'

import { Send } from 'lucide-react'
import { PlaceholderPage } from '@/components/shared/PlaceholderPage'

export default function ApplicationsPage() {
  return (
    <PlaceholderPage
      title="Applications"
      icon={Send}
      heading="Applications — Coming in Phase 2"
      body="When Proxim identifies strong matches and you approve them, your applications will be tracked here — status, responses, and next steps."
      ctaLabel="View Pipeline"
      ctaHref="/pipeline"
    />
  )
}
