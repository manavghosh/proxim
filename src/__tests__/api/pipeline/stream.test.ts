import { describe, it, expect, vi } from 'vitest'

const mockSelect = vi.fn()
vi.mock('@/db', () => ({
  db: {
    select: mockSelect,
  },
}))

describe('GET /api/pipeline/[jobId]/stream', () => {
  it('returns 404 for unknown jobId', async () => {
    // Mock db.select().from().where().limit() to return [] (job not found)
    const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) }
    mockSelect.mockReturnValue(chain)

    const { GET } = await import('@/app/api/pipeline/[jobId]/stream/route')
    const req = new Request('http://localhost/api/pipeline/unknown-id/stream')
    const res = await GET(req, { params: Promise.resolve({ jobId: 'unknown-id' }) })
    expect(res.status).toBe(404)
  })
})
