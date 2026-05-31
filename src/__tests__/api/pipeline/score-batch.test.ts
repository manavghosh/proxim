import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
}
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(() => mockUpdateChain),
  },
}))
vi.mock('@/lib/cv-service', () => ({
  getOrCreateCandidate: vi.fn().mockResolvedValue({ id: 'cand-1' }),
  getCandidateById: vi.fn().mockResolvedValue({ id: 'cand-1' }),
}))

describe('POST /api/pipeline/score-batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 400 when body is invalid JSON', async () => {
    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when jobIds is missing', async () => {
    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when jobIds is an empty array', async () => {
    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: JSON.stringify({ jobIds: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when jobIds is not an array', async () => {
    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: JSON.stringify({ jobIds: 'abc' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 with existing jobId when the exact same batch is already queued (dedup guard)', async () => {
    const { db } = await import('@/db')
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 'existing-score-job', payload: { job_ids: ['j1', 'j2'] } },
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockSelect as never)

    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: JSON.stringify({ jobIds: ['j1', 'j2'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.jobId).toBe('existing-score-job')
  })

  it('cancels queued score_jobs with different IDs before creating new job', async () => {
    const { db } = await import('@/db')
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 'old-queued-job', payload: { job_ids: [] } },
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockSelect as never)

    const cancelWhere = vi.fn().mockResolvedValue([])
    const cancelSet = vi.fn().mockReturnValue({ where: cancelWhere })
    vi.mocked(db.update).mockReturnValue({ set: cancelSet } as never)

    const insertValuesMock = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        { id: 'new-scoped-job', createdAt: new Date('2026-05-08T10:00:00Z') },
      ]),
    })
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never)

    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: JSON.stringify({ jobIds: ['j1', 'j2', 'j3'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.jobId).toBe('new-scoped-job')
    // The cancellation update must have been called
    expect(cancelSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'Superseded by a new scoring batch' }),
    )
  })

  it('creates a new job when a score_jobs is running but with different job IDs', async () => {
    const { db } = await import('@/db')
    // Existing job scores all (empty payload) — user now selects a specific batch
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 'old-score-all-job', payload: { job_ids: [] } },
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockSelect as never)

    const insertValuesMock = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        { id: 'new-scoped-job', createdAt: new Date('2026-05-08T10:00:00Z') },
      ]),
    })
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never)

    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: JSON.stringify({ jobIds: ['j1', 'j2', 'j3'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.jobId).toBe('new-scoped-job')
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { job_ids: ['j1', 'j2', 'j3'] } }),
    )
  })

  it('returns 201 with new pipelineJobId on successful enqueue with payload', async () => {
    const { db } = await import('@/db')
    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.select).mockReturnValue(mockSelect as never)

    const insertValuesMock = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        { id: 'new-job-id', createdAt: new Date('2026-05-08T10:00:00Z') },
      ]),
    })
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never)

    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=cand-1', {
      method: 'POST',
      body: JSON.stringify({ jobIds: ['j1', 'j2', 'j3'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.jobId).toBe('new-job-id')
    expect(body.status).toBe('queued')
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'score_jobs',
        candidateId: 'cand-1',
        payload: { job_ids: ['j1', 'j2', 'j3'] },
      }),
    )
  })

  it('returns 404 when candidateId does not match an existing candidate', async () => {
    const { getCandidateById } = await import('@/lib/cv-service')
    vi.mocked(getCandidateById).mockResolvedValueOnce(null as never)

    const { POST } = await import('@/app/api/pipeline/score-batch/route')
    const req = new Request('http://localhost/api/pipeline/score-batch?candidateId=missing', {
      method: 'POST',
      body: JSON.stringify({ jobIds: ['j1'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })
})
