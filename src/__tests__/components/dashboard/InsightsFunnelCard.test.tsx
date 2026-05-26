import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { InsightsFunnelCard } from '@/components/dashboard/InsightsFunnelCard'
import type { InsightsResponse } from '@/types/candidate'

const baseInsights: InsightsResponse = {
  funnel: { discovered: 42, approved: 30, day1Sent: 20, opened: 12, replied: 5, callbacks: 2 },
  rates: { openRate: 0.6, replyRate: 0.25, abGradeRate: 0.8, callbackRate: 0.1 },
  archetypeBreakdown: [],
}

const zeroInsights: InsightsResponse = {
  funnel: { discovered: 5, approved: 3, day1Sent: 0, opened: 0, replied: 0, callbacks: 0 },
  rates: { openRate: null, replyRate: null, abGradeRate: 0.67, callbackRate: null },
  archetypeBreakdown: [],
}

describe('InsightsFunnelCard', () => {
  it('renders all 6 funnel stage counts', () => {
    render(<InsightsFunnelCard insights={baseInsights} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('displays non-null rates as percentage strings', () => {
    render(<InsightsFunnelCard insights={baseInsights} />)
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('displays null rates as "—"', () => {
    render(<InsightsFunnelCard insights={zeroInsights} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('shows empty state message when day1Sent is 0', () => {
    render(<InsightsFunnelCard insights={zeroInsights} />)
    expect(screen.getByText(/send your first email to see performance data/i)).toBeInTheDocument()
  })

  it('does NOT show empty state message when day1Sent > 0', () => {
    render(<InsightsFunnelCard insights={baseInsights} />)
    expect(screen.queryByText(/send your first email to see performance data/i)).not.toBeInTheDocument()
  })

  it('renders loading skeletons when insights is null', () => {
    const { container } = render(<InsightsFunnelCard insights={null} />)
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})

describe('InsightsFunnelCard — archetype breakdown', () => {
  const withArchetypes: InsightsResponse = {
    ...baseInsights,
    archetypeBreakdown: [
      { archetype: 'Enterprise CAIO', approved: 10, sent: 8, replied: 4, replyRate: 0.5 },
      { archetype: 'Startup CTO', approved: 5, sent: 5, replied: 1, replyRate: 0.2 },
    ],
  }

  it('renders archetype names when breakdown has 2+ rows', () => {
    render(<InsightsFunnelCard insights={withArchetypes} />)
    expect(screen.getByText('Enterprise CAIO')).toBeInTheDocument()
    expect(screen.getByText('Startup CTO')).toBeInTheDocument()
  })

  it('first row is the highest reply-rate archetype', () => {
    render(<InsightsFunnelCard insights={withArchetypes} />)
    const rows = screen.getAllByRole('row')
    // First data row (index 1, after header) should contain highest-rate archetype
    expect(rows[1].textContent).toContain('Enterprise CAIO')
  })

  it('does not render breakdown section when archetypeBreakdown is empty', () => {
    render(<InsightsFunnelCard insights={baseInsights} />)
    expect(screen.queryByText(/archetype reply rates/i)).not.toBeInTheDocument()
  })

  it('does not render breakdown section when only 1 archetype', () => {
    render(<InsightsFunnelCard insights={{ ...baseInsights, archetypeBreakdown: [
      { archetype: 'Enterprise CAIO', approved: 10, sent: 8, replied: 4, replyRate: 0.5 },
    ]}} />)
    expect(screen.queryByText(/archetype reply rates/i)).not.toBeInTheDocument()
  })
})
