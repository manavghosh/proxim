import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(),
    insert: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  jobs: { id: 'id', status: 'status' },
  pipelineJobs: { id: 'id', jobType: 'jobType', candidateId: 'candidateId', payload: 'payload' },
  hitlCheckpoints: { jobId: 'jobId', candidateId: 'candidateId', status: 'status', decisionType: 'decisionType', decidedAt: 'decidedAt', snoozedUntil: 'snoozedUntil' },
}))

vi.mock('@/lib/hitl-checkpoint', () => ({
  upsertHitlCheckpoint: vi.fn().mockResolvedValue('checkpoint-1'),
}))

describe('POST /api/jobs/[jobId]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with pipelineJobId on success', async () => {
    const { db } = await import('@/db')
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'job-1', status: 'approved' }]),
    }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'pjob-1' }]),
    }
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const { POST } = await import('@/app/api/jobs/[jobId]/approve/route')
    const req = new Request('http://localhost/api/jobs/job-1/approve?candidateId=cand-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveProperty('jobId')
    expect(body).toHaveProperty('status', 'approved')
    expect(body).toHaveProperty('pipelineJobId')
  })

  it('returns 409 when already decided (0 rows affected)', async () => {
    const { db } = await import('@/db')
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    // Need to mock select for fetching current status
    const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> }
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ status: 'approved' }]),
    })

    const { POST } = await import('@/app/api/jobs/[jobId]/approve/route')
    const req = new Request('http://localhost/api/jobs/job-1/approve?candidateId=cand-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })

    expect(res.status).toBe(409)
  })

  it('returns 400 when candidateId is missing', async () => {
    const { POST } = await import('@/app/api/jobs/[jobId]/approve/route')
    const req = new Request('http://localhost/api/jobs/job-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    expect(res.status).toBe(400)
  })
})
