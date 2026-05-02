import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'

describe('PipelineLogPane', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ logs: [], jobStatus: 'running', jobError: null }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows idle hint when chainJobIds is empty', () => {
    render(<PipelineLogPane chainJobIds={[]} />)
    expect(screen.getByText(/Pipeline Log/i)).toBeInTheDocument()
    expect(screen.getByText(/Run Pipeline/i)).toBeInTheDocument()
  })

  it('shows waiting message when chainJobIds has a job', () => {
    render(<PipelineLogPane chainJobIds={['job-1']} />)
    expect(screen.getByText(/Pipeline Log/i)).toBeInTheDocument()
    expect(screen.getByText(/Waiting for pipeline/i)).toBeInTheDocument()
  })

  it('polls the logs endpoint when chainJobIds is set', () => {
    render(<PipelineLogPane chainJobIds={['job-1']} />)
    expect(global.fetch).toHaveBeenCalledWith('/api/pipeline/job-1/logs')
  })

  it('uses since param on subsequent polls after receiving logs', async () => {
    const timestamp = '2026-05-01T09:00:00.000Z'
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          logs: [{ id: 'l1', level: 'info', step: 'build_queries', message: 'Starting…', createdAt: timestamp }],
          jobStatus: 'running',
          jobError: null,
        }),
      } as never)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ logs: [], jobStatus: 'completed', jobError: null }),
      } as never)

    render(<PipelineLogPane chainJobIds={['job-1']} />)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`since=${encodeURIComponent(timestamp)}`)
    )
  })
})