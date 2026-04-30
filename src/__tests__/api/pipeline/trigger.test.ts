import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB module so module-level neon() call doesn't require DATABASE_URL
vi.mock('@/db', () => ({ db: {} }))
vi.mock('@/lib/cv-service', () => ({
  getOrCreateCandidate: vi.fn(),
}))

describe('POST /api/pipeline/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
