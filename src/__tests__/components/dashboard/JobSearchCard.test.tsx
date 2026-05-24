import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { JobSearchCard } from '@/components/dashboard/JobSearchCard'

vi.mock('@/lib/api', () => ({
  triggerPipeline: vi.fn(),
  getPipelineStatus: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function makeLastSearch(overrides = {}) {
  return {
    lastSearchAt: '2026-05-16T09:00:00Z',
    jobsDiscovered: 47,
    newJobs: 12,
    duplicatesSkipped: 35,
    ...overrides,
  }
}

const DEFAULT_PROPS = {
  candidateId: 'cand-1',
  awaitingReview: 9,
  scoreFailed: 2,
  onSearchComplete: vi.fn(),
}

describe('JobSearchCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders "Search for New Jobs" and "Re-score All" buttons in idle state', () => {
    render(
      <JobSearchCard
        {...DEFAULT_PROPS}
        lastSearch={makeLastSearch()}
      />,
    )
    expect(screen.getByRole('button', { name: /search for new jobs/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-score all/i })).toBeInTheDocument()
  })

  it('shows cooldown note when lastSearchAt is < 6 hours ago', () => {
    // 3 hours ago relative to our fixed test date of 2026-05-24
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    render(
      <JobSearchCard
        {...DEFAULT_PROPS}
        lastSearch={makeLastSearch({ lastSearchAt: threeHoursAgo })}
      />,
    )
    expect(screen.getByText(/results may be similar/i)).toBeInTheDocument()
  })

  it('does NOT show cooldown note when lastSearchAt is 8 hours ago', () => {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
    render(
      <JobSearchCard
        {...DEFAULT_PROPS}
        lastSearch={makeLastSearch({ lastSearchAt: eightHoursAgo })}
      />,
    )
    expect(screen.queryByText(/results may be similar/i)).not.toBeInTheDocument()
  })

  it('shows stale badge text when lastSearchAt is > 7 days ago', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    render(
      <JobSearchCard
        {...DEFAULT_PROPS}
        lastSearch={makeLastSearch({ lastSearchAt: tenDaysAgo })}
      />,
    )
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
  })

  it('shows "No searches yet" when lastSearch is null', () => {
    render(
      <JobSearchCard
        {...DEFAULT_PROPS}
        lastSearch={null}
      />,
    )
    expect(screen.getByText(/no searches yet/i)).toBeInTheDocument()
  })

  it('renders stats row with last-run numbers (47 jobs, +12 new, 9 awaiting, 2 failed)', () => {
    render(
      <JobSearchCard
        {...DEFAULT_PROPS}
        lastSearch={makeLastSearch({ jobsDiscovered: 47, newJobs: 12 })}
        awaitingReview={9}
        scoreFailed={2}
      />,
    )
    // Last run found: 47
    expect(screen.getByText('47')).toBeInTheDocument()
    // Awaiting review: 9
    expect(screen.getByText('9')).toBeInTheDocument()
    // Score failures: 2
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
