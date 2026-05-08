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

describe('POST /api/jobs/[jobId]/snooze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with snoozedUntil', async () => {
    const { db } = await import('@/db')
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'job-1', status: 'snoozed' }]),
    }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const { POST } = await import('@/app/api/jobs/[jobId]/snooze/route')
    const req = new Request('http://localhost/api/jobs/job-1/snooze?candidateId=cand-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 7 }),
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('snoozed')
    expect(body).toHaveProperty('snoozedUntil')
    expect(body).toHaveProperty('checkpointId')
  })

  it('sets snoozedUntil 7 days from now by default', async () => {
    const { db } = await import('@/db')
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'job-1', status: 'snoozed' }]),
    }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const before = Date.now()
    const { POST } = await import('@/app/api/jobs/[jobId]/snooze/route')
    const req = new Request('http://localhost/api/jobs/job-1/snooze?candidateId=cand-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    const body = await res.json()
    const after = Date.now()

    const snoozedUntil = new Date(body.snoozedUntil).getTime()
    const expectedMin = before + 6 * 24 * 3600 * 1000
    const expectedMax = after + 8 * 24 * 3600 * 1000
    expect(snoozedUntil).toBeGreaterThan(expectedMin)
    expect(snoozedUntil).toBeLessThan(expectedMax)
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
      limit: vi.fn().mockResolvedValue([{ status: 'snoozed' }]),
    } as never)

    const { POST } = await import('@/app/api/jobs/[jobId]/snooze/route')
    const req = new Request('http://localhost/api/jobs/job-1/snooze?candidateId=cand-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 7 }),
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    expect(res.status).toBe(409)
  })
})
