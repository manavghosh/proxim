'use client'

import { Workflow } from 'lucide-react'
import { PlaceholderPage } from '@/components/shared/PlaceholderPage'

export default function PipelinePage() {
  return (
    <PlaceholderPage
      title="Pipeline"
      icon={Workflow}
      heading="Pipeline — Coming in Phase 2"
      body="Once your profile is ready, Proxim will automatically search for matching roles, score them against your preferences, and surface the best opportunities here."
      ctaLabel="Complete your profile"
      ctaHref="/settings"
    />
  )
}
