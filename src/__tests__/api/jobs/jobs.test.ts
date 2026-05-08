import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB module so module-level neon() call doesn't require DATABASE_URL
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/cv-service', () => ({
  getOrCreateCandidate: vi.fn().mockResolvedValue({ id: 'cand-1' }),
  getCandidateById: vi.fn().mockResolvedValue({ id: 'cand-1' }),
}))

vi.mock('@/db/schema', () => ({
  jobs: { id: 'id', candidateId: 'candidateId', grade: 'grade', status: 'status', reportMd: 'reportMd' },
}))

describe('GET /api/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with jobs array when no scored jobs', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/jobs/route')
    const req = new Request('http://localhost/api/jobs')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
    expect(body.jobs).toHaveLength(0)
  })

  it('filters out F-grade jobs', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        { id: '1', grade: 'F', status: 'scored', title: 'Test', company: 'Co',
          location: null, source: 'linkedin', sourceUrl: 'http://x.com',
          postedAt: null, score10d: null, archetype: null, archetypeConfidence: null, createdAt: '2026-01-01' },
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/jobs/route')
    const req = new Request('http://localhost/api/jobs?grades=A,B,C,D')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.jobs).toHaveLength(0)  // F-grade filtered out
  })

  it('returns A-grade jobs when filter=A', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        { id: '1', grade: 'A', status: 'scored', title: 'Test', company: 'Co',
          location: null, source: 'linkedin', sourceUrl: 'http://x.com',
          postedAt: null, score10d: null, archetype: null, archetypeConfidence: null, createdAt: '2026-01-01' },
        { id: '2', grade: 'B', status: 'scored', title: 'Test2', company: 'Co2',
          location: null, source: 'linkedin', sourceUrl: 'http://y.com',
          postedAt: null, score10d: null, archetype: null, archetypeConfidence: null, createdAt: '2026-01-02' },
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/jobs/route')
    const req = new Request('http://localhost/api/jobs?grades=A')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].grade).toBe('A')
  })
})

describe('POST /api/jobs/[jobId]/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 400 for invalid decision', async () => {
    const { POST } = await import('@/app/api/jobs/[jobId]/decision/route')
    const req = new Request('http://localhost/api/jobs/job-1/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'invalid_decision' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing decision', async () => {
    const { POST } = await import('@/app/api/jobs/[jobId]/decision/route')
    const req = new Request('http://localhost/api/jobs/job-1/decision', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/jobs/[jobId]/report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 404 for unknown jobId', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/jobs/[jobId]/report/route')
    const req = new Request('http://localhost/api/jobs/unknown/report')
    const res = await GET(req, { params: Promise.resolve({ jobId: 'unknown' }) })
    expect(res.status).toBe(404)
  })

  it('returns reportMd and grade for known job', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ reportMd: '## Report', grade: 'B' }]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/jobs/[jobId]/report/route')
    const req = new Request('http://localhost/api/jobs/job-1/report')
    const res = await GET(req, { params: Promise.resolve({ jobId: 'job-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.grade).toBe('B')
    expect(body.reportMd).toBe('## Report')
  })
})
