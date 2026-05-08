import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
  },
}))
vi.mock('@/lib/cv-service', () => ({
  getOrCreateCandidate: vi.fn().mockResolvedValue({ id: 'cand-1' }),
  getCandidateById: vi.fn().mockResolvedValue({ id: 'cand-1' }),
}))

describe('GET /api/jobs/ready-to-score', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns totalJobs=0 and empty groups when no jobs are ready', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/jobs/ready-to-score/route')
    const req = new Request('http://localhost/api/jobs/ready-to-score?candidateId=cand-1')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ totalJobs: 0, groups: [] })
  })

  it('groups returned rows by normalized position', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 'j1', title: 'Sr. Director', company: 'Acme' },
        { id: 'j2', title: 'Senior Director, AI', company: 'Globex' },
        { id: 'j3', title: 'Data Analyst', company: 'Initech' },
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/jobs/ready-to-score/route')
    const req = new Request('http://localhost/api/jobs/ready-to-score?candidateId=cand-1')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalJobs).toBe(3)
    expect(body.groups).toHaveLength(2)
    const seniorDir = body.groups.find((g: { position: string }) => g.position === 'Senior Director')
    expect(seniorDir.count).toBe(2)
    expect(seniorDir.jobIds).toEqual(['j1', 'j2'])
  })

  it('returns 404 when candidateId does not match an existing candidate', async () => {
    const { getCandidateById } = await import('@/lib/cv-service')
    vi.mocked(getCandidateById).mockResolvedValueOnce(null as never)

    const { GET } = await import('@/app/api/jobs/ready-to-score/route')
    const req = new Request('http://localhost/api/jobs/ready-to-score?candidateId=does-not-exist')
    const res = await GET(req)

    expect(res.status).toBe(404)
  })
})
