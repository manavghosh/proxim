import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { JobCard } from '@/components/applications/JobCard'

const baseJob = {
  id: 'job-1',
  title: 'Director of AI',
  company: 'Acme Corp',
  location: 'Bengaluru, Karnataka, India',
  source: 'linkedin',
  sourceUrl: 'https://linkedin.com/jobs/view/123',
  postedAt: null,
  status: 'scored',
  grade: 'B',
  score10d: null,
  archetype: 'GCC AI Practice Head',
  archetypeConfidence: '0.82',
  createdAt: '2026-05-02T00:00:00Z',
}

describe('JobCard', () => {
  it('renders grade badge with correct letter', () => {
    render(
      <JobCard
        job={baseJob}
        onDecision={vi.fn()}
        onViewReport={vi.fn()}
        isPending={false}
      />
    )
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('renders company and title', () => {
    render(
      <JobCard
        job={baseJob}
        onDecision={vi.fn()}
        onViewReport={vi.fn()}
        isPending={false}
      />
    )
    expect(screen.getByText('Director of AI')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('calls onDecision with approved when Approve clicked', () => {
    const onDecision = vi.fn()
    render(
      <JobCard
        job={baseJob}
        onDecision={onDecision}
        onViewReport={vi.fn()}
        isPending={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onDecision).toHaveBeenCalledWith('job-1', 'approved')
  })

  it('disables buttons when isPending is true', () => {
    render(
      <JobCard
        job={baseJob}
        onDecision={vi.fn()}
        onViewReport={vi.fn()}
        isPending={true}
      />
    )
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled()
  })
})
