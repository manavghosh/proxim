import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'

vi.mock('@/lib/api', () => ({
  getCV: vi.fn(),
}))

describe('ParseStatusBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the label that matches initialStatus on mount', () => {
    render(<ParseStatusBadge initialStatus="failed" candidateId="cand-1" />)
    expect(screen.getByText('Parse failed')).toBeInTheDocument()
  })

  it('updates the badge when initialStatus prop changes (failed → parsing → ready)', () => {
    // This is the regression we just fixed: without the useEffect that syncs
    // internal state with the initialStatus prop, the badge stays stuck on
    // its mount value forever.
    const { rerender } = render(
      <ParseStatusBadge initialStatus="failed" candidateId="cand-1" />,
    )
    expect(screen.getByText('Parse failed')).toBeInTheDocument()

    rerender(<ParseStatusBadge initialStatus="parsing" candidateId="cand-1" />)
    expect(screen.getByText('Parsing CV…')).toBeInTheDocument()

    rerender(<ParseStatusBadge initialStatus="ready" candidateId="cand-1" />)
    expect(screen.getByText('Profile ready')).toBeInTheDocument()
  })

  it('updates the badge when reparse flips status back from ready → failed', () => {
    const { rerender } = render(
      <ParseStatusBadge initialStatus="ready" candidateId="cand-1" />,
    )
    expect(screen.getByText('Profile ready')).toBeInTheDocument()

    rerender(<ParseStatusBadge initialStatus="failed" candidateId="cand-1" />)
    expect(screen.getByText('Parse failed')).toBeInTheDocument()
  })
})
