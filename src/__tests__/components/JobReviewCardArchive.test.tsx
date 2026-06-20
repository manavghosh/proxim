import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { JobReviewCard } from '@/components/pipeline/JobReviewCard'
import type { HitlJob } from '@/lib/api'

function makeJob(overrides: Partial<HitlJob> = {}): HitlJob {
  return {
    id: 'j1', title: 'Head of AI', company: 'Acme Corp',
    location: null, source: 'linkedin', sourceUrl: 'https://linkedin.com/jobs/view/123',
    postedAt: null, createdAt: new Date().toISOString(), status: 'scored', grade: 'A', numericScore: 4.2,
    origin: 'discovered', batchId: null,
    score10d: null, reportMd: null, archetype: null, archetypeConfidence: null,
    hitlCheckpoint: null, outreachTarget: null, emailCadence: null,
    errorMessage: null,
    ...overrides,
  }
}

const handlers = {
  onApprove: vi.fn(), onReject: vi.fn(), onSnooze: vi.fn(), onUnsnooze: vi.fn(),
  onGenerateResume: vi.fn(), onArchive: vi.fn(), onUpdate: vi.fn(),
}

describe('JobReviewCard archive', () => {
  it('renders an archive button and calls onArchive with the job id', () => {
    const onArchive = vi.fn()
    render(
      <JobReviewCard job={makeJob()} candidateId="cand1" isPending={false} {...handlers} onArchive={onArchive} />
    )
    const btn = screen.getByTestId('archive-btn')
    fireEvent.click(btn)
    expect(onArchive).toHaveBeenCalledWith('j1')
  })

  it('exposes the archive control even on an approved (read-only-actions) job', () => {
    render(
      <JobReviewCard job={makeJob({ status: 'approved' })} candidateId="cand1" isPending={false} {...handlers} />
    )
    expect(screen.getByTestId('archive-btn')).toBeInTheDocument()
  })
})
