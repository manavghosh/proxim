import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  jobs: { id: 'id', status: 'status' },
  hitlCheckpoints: { jobId: 'jobId', candidateId: 'candidateId', status: 'status', decisionType: 'decisionType', decidedAt: 'decidedAt', snoozedUntil: 'snoozedUntil' },
}))

vi.mock('@/lib/hitl-checkpoint', () => ({
  upsertHitlCheckpoint: vi.fn().mockResolvedValue('checkpoint-1'),
}))

describe('POST /api/jobs/[jobId]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 on success', async () => {
    const { db } = await import('@/db')
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'job-1', status: 'rejected' }]),
    }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const { POST } = await import('@/app/api/jobs/[jobId]/reject/route')
    const req = new Request('http://localhost/api/jobs/job-1/reject?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('rejected')
  })

  it('returns 409 when already decided', async () => {
    const { db } = await import('@/db')
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ status: 'rejected' }]),
    } as never)

    const { POST } = await import('@/app/api/jobs/[jobId]/reject/route')
    const req = new Request('http://localhost/api/jobs/job-1/reject?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })

    expect(res.status).toBe(409)
  })

  it('returns 400 when candidateId is missing', async () => {
    const { POST } = await import('@/app/api/jobs/[jobId]/reject/route')
    const req = new Request('http://localhost/api/jobs/job-1/reject', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    expect(res.status).toBe(400)
  })
})
