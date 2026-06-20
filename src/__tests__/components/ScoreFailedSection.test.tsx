import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScoreFailedSection } from '@/components/pipeline/ScoreFailedSection'
import type { HitlJob } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  resetFailedJobs: vi.fn().mockResolvedValue({ reset: 2 }),
  retryScoring:    vi.fn().mockResolvedValue({ pipelineJobId: 'pj1', status: 'queued' }),
  triggerPipeline: vi.fn().mockResolvedValue({ jobId: 'pj2', status: 'queued' }),
}))

function makeJob(overrides: Partial<HitlJob> = {}): HitlJob {
  return {
    id: 'j1', title: 'Head of AI', company: 'Acme Corp',
    location: null, source: 'linkedin', sourceUrl: 'https://linkedin.com/jobs/view/123',
    postedAt: null, createdAt: new Date().toISOString(), status: 'score_failed', grade: null, numericScore: null,
    origin: 'discovered', batchId: null,
    score10d: null, reportMd: null, archetype: null, archetypeConfidence: null,
    hitlCheckpoint: null, outreachTarget: null, emailCadence: null,
    errorMessage: 'No job description found — try re-importing with a direct job URL',
    ...overrides,
  }
}

const baseProps = {
  jobs: [
    makeJob(),
    makeJob({ id: 'j2', title: 'CTO', errorMessage: 'Scoring failed unexpectedly — click Retry to try again' }),
  ],
  candidateId: 'cand1',
  onRetried: vi.fn(),
  onDismiss: vi.fn(),
}

describe('ScoreFailedSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders header with correct count', () => {
    render(<ScoreFailedSection {...baseProps} />)
    expect(screen.getByText(/2 job/i)).toBeInTheDocument()
  })

  it('is collapsed by default — job rows not visible', () => {
    render(<ScoreFailedSection {...baseProps} />)
    expect(screen.queryByText('Head of AI')).not.toBeInTheDocument()
  })

  it('expands when header is clicked', () => {
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /job.*could not be scored/i }))
    expect(screen.getByText('Head of AI')).toBeInTheDocument()
    expect(screen.getByText('CTO')).toBeInTheDocument()
  })

  it('shows error reason for each job when expanded', () => {
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /job.*could not be scored/i }))
    expect(screen.getByText(/No job description found/)).toBeInTheDocument()
    expect(screen.getByText(/Scoring failed unexpectedly/)).toBeInTheDocument()
  })

  it('per-job Retry calls retryScoring and onRetried', async () => {
    const { retryScoring } = await import('@/lib/api')
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /job.*could not be scored/i }))
    const retryBtns = screen.getAllByRole('button', { name: /^retry$/i })
    fireEvent.click(retryBtns[0])
    await waitFor(() => expect(retryScoring).toHaveBeenCalledWith('j1', 'cand1'))
    expect(baseProps.onRetried).toHaveBeenCalledWith('pj1')
  })

  it('Retry All calls resetFailedJobs + triggerPipeline then onRetried', async () => {
    const { resetFailedJobs, triggerPipeline } = await import('@/lib/api')
    render(<ScoreFailedSection {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /retry all/i }))
    await waitFor(() => expect(resetFailedJobs).toHaveBeenCalledWith('cand1'))
    expect(triggerPipeline).toHaveBeenCalledWith('score_jobs', 'cand1')
    expect(baseProps.onRetried).toHaveBeenCalledWith('pj2')
  })

  it('unreadable jobs show Dismiss (not Retry) and call onDismiss', async () => {
    const onDismiss = vi.fn()
    const jobs = [makeJob({
      id: 'j3', title: 'Wall Page',
      errorMessage: "Couldn't read this posting — the link returned a search, login, or expired page, not a job. Re-add the direct job URL (…/jobs/view/…).",
    })]
    render(<ScoreFailedSection {...baseProps} jobs={jobs} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /job.*could not be scored/i }))
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry all/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('j3'))
  })
})
