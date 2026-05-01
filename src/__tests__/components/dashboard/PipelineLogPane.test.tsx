import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'

describe('PipelineLogPane', () => {
  it('renders nothing when jobId is null', () => {
    const { container } = render(<PipelineLogPane jobId={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows Pipeline Log header and waiting message when jobId is set', () => {
    const mockES = { addEventListener: vi.fn(), close: vi.fn() }
    vi.stubGlobal('EventSource', vi.fn(() => mockES))

    render(<PipelineLogPane jobId="job-1" />)

    expect(screen.getByText(/Pipeline Log/i)).toBeInTheDocument()
    expect(screen.getByText(/Waiting for pipeline/i)).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('opens EventSource for the correct jobId URL', () => {
    const mockES = { addEventListener: vi.fn(), close: vi.fn() }
    const MockEventSource = vi.fn(() => mockES)
    vi.stubGlobal('EventSource', MockEventSource)

    render(<PipelineLogPane jobId="job-abc" />)

    expect(MockEventSource).toHaveBeenCalledWith('/api/pipeline/job-abc/stream')

    vi.unstubAllGlobals()
  })
})
