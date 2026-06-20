import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ArchivedJob } from '@/lib/api'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'cand1' }),
}))

vi.mock('@/components/layout/CandidateSwitcher', () => ({
  CandidateSwitcher: () => null,
}))

vi.mock('@/lib/api', () => ({
  getArchivedJobs: vi.fn(),
  unarchiveJob: vi.fn().mockResolvedValue({ jobId: 'j1', archived: false, status: 'scored' }),
}))

import ArchivedPage from '@/app/candidates/[id]/archived/page'
import { getArchivedJobs, unarchiveJob } from '@/lib/api'

function makeArchived(overrides: Partial<ArchivedJob> = {}): ArchivedJob {
  return {
    id: 'j1', title: 'Head of AI', company: 'Acme Corp', location: null,
    sourceUrl: 'https://linkedin.com/jobs/view/1', status: 'scored', grade: 'A',
    postedAt: null, archivedAt: new Date().toISOString(), createdAt: null,
    ...overrides,
  }
}

describe('ArchivedPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders an archived job row per job', async () => {
    vi.mocked(getArchivedJobs).mockResolvedValue({
      jobs: [makeArchived(), makeArchived({ id: 'j2', title: 'CTO', status: 'rejected', grade: 'B' })],
      total: 2,
    })
    render(<ArchivedPage />)
    expect(await screen.findByText('Head of AI')).toBeInTheDocument()
    expect(screen.getByText('CTO')).toBeInTheDocument()
    expect(screen.getAllByTestId('archived-job-row')).toHaveLength(2)
  })

  it('shows an empty state when there are no archived jobs', async () => {
    vi.mocked(getArchivedJobs).mockResolvedValue({ jobs: [], total: 0 })
    render(<ArchivedPage />)
    expect(await screen.findByText(/No archived jobs/i)).toBeInTheDocument()
  })

  it('Retrieve calls unarchiveJob and removes the row', async () => {
    vi.mocked(getArchivedJobs).mockResolvedValue({ jobs: [makeArchived()], total: 1 })
    render(<ArchivedPage />)
    const btn = await screen.findByTestId('retrieve-btn')
    fireEvent.click(btn)
    await waitFor(() => expect(unarchiveJob).toHaveBeenCalledWith('j1', 'cand1'))
    await waitFor(() => expect(screen.queryByText('Head of AI')).not.toBeInTheDocument())
  })
})
