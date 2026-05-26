import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { JobCard } from '@/components/applications/JobCard'
import type { ScoredJob } from '@/lib/api'

const baseJob: ScoredJob = {
  id: 'job-1',
  title: 'Director of AI',
  company: 'Acme Corp',
  location: 'Bengaluru, Karnataka, India',
  source: 'linkedin',
  sourceUrl: 'https://linkedin.com/jobs/view/123',
  postedAt: null,
  status: 'resume_ready',
  grade: 'B',
  score10d: null,
  archetype: 'GCC AI Practice Head',
  archetypeConfidence: '0.82',
  createdAt: '2026-05-02T00:00:00Z',
  updatedAt: '2026-05-02T00:00:00Z',
  interviewCallbackAt: null,
  errorMessage: null,
  pipelineJobStatus: null,
  jdRaw: 'some job description text',
  outreachTarget: null,
  emailCadence: null,
}

function defaultProps() {
  return {
    job: baseJob,
    candidateId: 'cand-1',
    onMarkSubmitted: vi.fn(),
    onMoveToRejected: vi.fn(),
    onGenerateResume: vi.fn(),
    onRetryResume: vi.fn(),
    onViewResume: vi.fn(),
    isPending: false,
  }
}

describe('JobCard', () => {
  it('renders grade badge with correct letter', () => {
    render(<JobCard {...defaultProps()} />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('renders company and title', () => {
    render(<JobCard {...defaultProps()} />)
    expect(screen.getByText('Director of AI')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('does NOT render decision buttons (Approve/Reject/Snooze) — those live on the Pipeline page', () => {
    render(<JobCard {...defaultProps()} />)
    expect(screen.queryByRole('button', { name: /^Approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Snooze/i })).not.toBeInTheDocument()
  })

  it('shows Mark Submitted button only when status is resume_ready', () => {
    render(<JobCard {...defaultProps()} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Expand job card/i })) })
    expect(screen.getByRole('button', { name: /Mark Submitted/i })).toBeInTheDocument()
  })

  it('hides Mark Submitted when status is not resume_ready', () => {
    const props = defaultProps()
    props.job = { ...baseJob, status: 'approved' }
    render(<JobCard {...props} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Expand job card/i })) })
    expect(screen.queryByRole('button', { name: /Mark Submitted/i })).not.toBeInTheDocument()
  })

  it('calls onMarkSubmitted when Mark Submitted is clicked', () => {
    const props = defaultProps()
    render(<JobCard {...props} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Expand job card/i })) })
    fireEvent.click(screen.getByRole('button', { name: /Mark Submitted/i }))
    expect(props.onMarkSubmitted).toHaveBeenCalledWith('job-1')
  })

  it('exposes a "More actions" overflow trigger for non-rejected jobs', () => {
    // Note: we don't open the Radix DropdownMenu in this test because Radix
    // listens to pointer events that jsdom doesn't dispatch via fireEvent.click.
    // Verifying the trigger renders is enough to pin the public contract; the
    // actual onMoveToRejected wiring is also covered by the page-level handler.
    const props = defaultProps()
    render(<JobCard {...props} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Expand job card/i })) })
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument()
  })

  it('hides the "More actions" overflow when the job is already rejected', () => {
    const props = defaultProps()
    props.job = { ...baseJob, status: 'rejected' }
    render(<JobCard {...props} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Expand job card/i })) })
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()
  })

  it('disables Mark Submitted when isPending is true', () => {
    render(<JobCard {...defaultProps()} isPending={true} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Expand job card/i })) })
    expect(screen.getByRole('button', { name: /Mark Submitted/i })).toBeDisabled()
  })
})
