import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  emailCadences: {
    id: 'id', jobId: 'jobId', candidateId: 'candidateId', status: 'status',
    approvedAt: 'approvedAt',
  },
  emailDrafts: {
    id: 'id', cadenceId: 'cadenceId', dayNumber: 'dayNumber', status: 'status',
    isApproved: 'isApproved', scheduledSendAt: 'scheduledSendAt',
  },
}))

const makeCadence = (overrides = {}) => ({
  id: 'cad-001',
  jobId: 'job-001',
  candidateId: 'cand-001',
  status: 'pending_approval',
  approvedAt: null,
  ...overrides,
})

describe('POST /api/email-cadence/[cadenceId]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with approved status and day1 scheduled', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence()]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'cad-001', status: 'approved', approvedAt: new Date().toISOString() }]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/approve/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/approve?candidateId=cand-001', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('cadenceId')
    expect(body).toHaveProperty('status', 'approved')
  })

  it('returns 409 when already approved', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence({ status: 'approved' })]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/approve/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/approve?candidateId=cand-001', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(409)
  })

  it('returns 422 when cadence not in pending_approval status', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence({ status: 'discovering' })]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/approve/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/approve?candidateId=cand-001', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(422)
  })

  it('returns 404 when cadence not found', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/approve/route')
    const req = new Request('http://localhost/api/email-cadence/unknown/approve?candidateId=cand-001', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'unknown' }) })

    expect(res.status).toBe(404)
  })

  it('sets approved_at timestamp on success', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence()]),
    } as never)
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'cad-001', status: 'approved', approvedAt: '2026-05-17T10:00:00Z' }]),
    })
    vi.mocked(db.update).mockImplementation(mockUpdate as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/approve/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/approve?candidateId=cand-001', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('approvedAt')
  })
})
