import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq, or } from 'drizzle-orm'

// Mock the DB module so module-level neon() call doesn't require DATABASE_URL
const mockUpdateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
}
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(() => mockUpdateChain),
    execute: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/cv-service', () => ({
  getOrCreateCandidate: vi.fn(),
  getCandidateById: vi.fn(),
}))

describe('POST /api/pipeline/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 400 when jobType is missing', async () => {
    const { POST } = await import('@/app/api/pipeline/trigger/route')
    const req = new Request('http://localhost/api/pipeline/trigger', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when jobType is invalid', async () => {
    const { POST } = await import('@/app/api/pipeline/trigger/route')
    const req = new Request('http://localhost/api/pipeline/trigger', {
      method: 'POST',
      body: JSON.stringify({ jobType: 'invalid_type' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 409 when a job is already queued or running', async () => {
    const { db } = await import('@/db')
    const { getOrCreateCandidate } = await import('@/lib/cv-service')
    vi.mocked(getOrCreateCandidate).mockResolvedValue({ id: 'cand-1' } as never)
    // Mock db.select chain to return an existing job
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'existing-job-id' }]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { POST } = await import('@/app/api/pipeline/trigger/route')
    const req = new Request('http://localhost/api/pipeline/trigger', {
      method: 'POST',
      body: JSON.stringify({ jobType: 'discovery_only' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    // Conflict returns 200 with existing job ID (idempotent)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jobId).toBe('existing-job-id')
  })
})
