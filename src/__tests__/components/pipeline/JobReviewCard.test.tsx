import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { JobReviewCard } from '@/components/pipeline/JobReviewCard'
import type { HitlJob } from '@/lib/api'

const baseJob: HitlJob = {
  id: 'job-1',
  title: 'VP of AI Engineering',
  company: 'Acme Corp',
  location: 'Bengaluru',
  source: 'naukri',
  sourceUrl: 'https://naukri.com/1',
  postedAt: '2026-05-01T00:00:00Z',
  createdAt: '2026-05-01T00:00:00Z',
  status: 'awaiting',
  grade: 'A',
  numericScore: 4.6,
  score10d: null,
  reportMd: '## Executive Summary\nGreat fit.',
  archetype: 'Agentic Systems Architect',
  archetypeConfidence: '0.9',
  hitlCheckpoint: {
    id: 'cp-1',
    status: 'awaiting',
    snoozedUntil: null,
    createdAt: '2026-05-03T10:00:00Z',
  },
  outreachTarget: null,
  emailCadence: null,
  errorMessage: null,
}

const makeProps = (overrides: Partial<HitlJob> = {}) => ({
  job: { ...baseJob, ...overrides },
  candidateId: 'cand-1',
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onSnooze: vi.fn(),
  onUnsnooze: vi.fn(),
  onGenerateResume: vi.fn(),
  onUpdate: vi.fn(),
  isPending: false,
})

describe('JobReviewCard', () => {
  it('renders grade badge with the grade letter and an inline grade colour', () => {
    render(<JobReviewCard {...makeProps()} />)
    const badge = screen.getByTestId('grade-badge')
    expect(badge.textContent).toBe('A')
    // Colour now comes from the single-source grade scale via inline style
    // (GradeBadge), not a Tailwind class.
    expect(badge.style.color).toBeTruthy()
    expect(badge.style.backgroundColor).toBeTruthy()
  })

  it('renders numeric score', () => {
    render(<JobReviewCard {...makeProps()} />)
    expect(screen.getByText(/4\.6/)).toBeTruthy()
  })

  it('renders company and title', () => {
    render(<JobReviewCard {...makeProps()} />)
    expect(screen.getByText('VP of AI Engineering')).toBeTruthy()
    expect(screen.getByText('Acme Corp')).toBeTruthy()
  })

  it('calls onApprove when Approve button is clicked', () => {
    const onApprove = vi.fn()
    render(<JobReviewCard {...makeProps()} onApprove={onApprove} />)
    fireEvent.click(screen.getByTestId('approve-btn'))
    expect(onApprove).toHaveBeenCalledWith('job-1')
  })

  it('calls onReject when Reject button is clicked', () => {
    const onReject = vi.fn()
    render(<JobReviewCard {...makeProps()} onReject={onReject} />)
    fireEvent.click(screen.getByTestId('reject-btn'))
    expect(onReject).toHaveBeenCalledWith('job-1')
  })

  it('calls onSnooze when Snooze button is clicked for non-snoozed job', () => {
    const onSnooze = vi.fn()
    render(<JobReviewCard {...makeProps()} onSnooze={onSnooze} />)
    fireEvent.click(screen.getByTestId('snooze-btn'))
    expect(onSnooze).toHaveBeenCalledWith('job-1')
  })

  it('calls onUnsnooze when Unsnooze button is clicked for snoozed job', () => {
    const onUnsnooze = vi.fn()
    render(
      <JobReviewCard
        {...makeProps({ status: 'snoozed' })}
        onUnsnooze={onUnsnooze}
      />
    )
    fireEvent.click(screen.getByTestId('snooze-btn'))
    expect(onUnsnooze).toHaveBeenCalledWith('job-1')
  })

  it('toggles report pane when report toggle is clicked', () => {
    render(<JobReviewCard {...makeProps()} />)
    const toggle = screen.getByTestId('report-toggle')
    expect(screen.queryByText(/Executive Summary/)).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText(/Executive Summary/)).toBeTruthy()
  })

  it('gives each grade its own colour (B differs from A)', () => {
    const { unmount } = render(<JobReviewCard {...makeProps()} />)
    const aColor = screen.getByTestId('grade-badge').style.color
    unmount()
    render(<JobReviewCard {...makeProps({ grade: 'B' })} />)
    const bBadge = screen.getByTestId('grade-badge')
    expect(bBadge.textContent).toBe('B')
    expect(bBadge.style.color).toBeTruthy()
    expect(bBadge.style.color).not.toBe(aColor)
  })
})

describe('JobReviewCard — New badge', () => {
  it('shows "New" badge for jobs created within 24 hours', () => {
    const recentJob = {
      ...baseJob,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    }
    render(<JobReviewCard {...makeProps(recentJob)} />)
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('does not show "New" badge for jobs older than 24 hours', () => {
    const oldJob = {
      ...baseJob,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    }
    render(<JobReviewCard {...makeProps(oldJob)} />)
    expect(screen.queryByText('New')).not.toBeInTheDocument()
  })
})
