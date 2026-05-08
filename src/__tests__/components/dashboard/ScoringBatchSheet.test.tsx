import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScoringBatchSheet } from '@/components/dashboard/ScoringBatchSheet'

vi.mock('@/lib/api', () => ({
  getReadyToScoreGroups: vi.fn(),
  scoreBatch: vi.fn(),
}))

import { getReadyToScoreGroups, scoreBatch } from '@/lib/api'

const mockedGetGroups = vi.mocked(getReadyToScoreGroups)
const mockedScoreBatch = vi.mocked(scoreBatch)

const fakeGroups = {
  totalJobs: 5,
  groups: [
    {
      position: 'Senior Director',
      rawTitles: ['Sr. Director', 'Senior Director, AI'],
      count: 3,
      jobIds: ['j1', 'j2', 'j3'],
      sampleCompanies: ['Acme', 'Globex'],
    },
    {
      position: 'Data Analyst',
      rawTitles: ['Data Analyst'],
      count: 2,
      jobIds: ['j4', 'j5'],
      sampleCompanies: ['Initech'],
    },
  ],
}

describe('ScoringBatchSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not fetch groups while closed', () => {
    render(
      <ScoringBatchSheet
        open={false}
        onOpenChange={() => {}}
        candidateId="cand-1"
        onScored={() => {}}
      />,
    )
    expect(mockedGetGroups).not.toHaveBeenCalled()
  })

  it('fetches groups when opened', async () => {
    mockedGetGroups.mockResolvedValueOnce({ totalJobs: 0, groups: [] })
    render(
      <ScoringBatchSheet
        open={true}
        onOpenChange={() => {}}
        candidateId="cand-1"
        onScored={() => {}}
      />,
    )
    await waitFor(() => expect(mockedGetGroups).toHaveBeenCalledWith('cand-1'))
  })

  it('renders the empty state when there are no ready jobs', async () => {
    mockedGetGroups.mockResolvedValueOnce({ totalJobs: 0, groups: [] })
    render(
      <ScoringBatchSheet
        open={true}
        onOpenChange={() => {}}
        candidateId="cand-1"
        onScored={() => {}}
      />,
    )
    expect(await screen.findByText(/no jobs ready to score/i)).toBeInTheDocument()
  })

  it('renders one row per position group with counts', async () => {
    mockedGetGroups.mockResolvedValueOnce(fakeGroups)
    render(
      <ScoringBatchSheet
        open={true}
        onOpenChange={() => {}}
        candidateId="cand-1"
        onScored={() => {}}
      />,
    )
    expect(await screen.findByText('Senior Director')).toBeInTheDocument()
    expect(screen.getByText('Data Analyst')).toBeInTheDocument()
    // Counts visible somewhere on the row
    const seniorRow = screen.getByText('Senior Director').closest('[data-position]')
    expect(seniorRow?.textContent).toContain('3')
  })

  it('disables the submit button when nothing is selected', async () => {
    mockedGetGroups.mockResolvedValueOnce(fakeGroups)
    render(
      <ScoringBatchSheet
        open={true}
        onOpenChange={() => {}}
        candidateId="cand-1"
        onScored={() => {}}
      />,
    )
    const submit = await screen.findByRole('button', { name: /score selected/i })
    expect(submit).toBeDisabled()
  })

  it('selects a group when its toggle is clicked and updates the submit count', async () => {
    mockedGetGroups.mockResolvedValueOnce(fakeGroups)
    render(
      <ScoringBatchSheet
        open={true}
        onOpenChange={() => {}}
        candidateId="cand-1"
        onScored={() => {}}
      />,
    )
    const seniorToggle = await screen.findByRole('button', { name: /toggle Senior Director/i })
    fireEvent.click(seniorToggle)
    const submit = await screen.findByRole('button', { name: /score selected \(3\)/i })
    expect(submit).toBeEnabled()
  })

  it('submits the union of selected groups\' jobIds and bubbles the new pipelineJobId', async () => {
    mockedGetGroups.mockResolvedValueOnce(fakeGroups)
    mockedScoreBatch.mockResolvedValueOnce({ jobId: 'pipeline-99', status: 'queued' })
    const onScored = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ScoringBatchSheet
        open={true}
        onOpenChange={onOpenChange}
        candidateId="cand-1"
        onScored={onScored}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /toggle Senior Director/i }))
    fireEvent.click(screen.getByRole('button', { name: /toggle Data Analyst/i }))
    fireEvent.click(screen.getByRole('button', { name: /score selected \(5\)/i }))

    await waitFor(() => expect(mockedScoreBatch).toHaveBeenCalledWith(
      'cand-1',
      ['j1', 'j2', 'j3', 'j4', 'j5'],
    ))
    expect(onScored).toHaveBeenCalledWith('pipeline-99')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
