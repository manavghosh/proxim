import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/db/schema', () => ({
  emailCadences: { id: 'id', candidateId: 'candidateId', status: 'status' },
  emailDrafts: { id: 'id', cadenceId: 'cadenceId', dayNumber: 'dayNumber', status: 'status', scheduledSendAt: 'scheduledSendAt' },
}))

describe('POST /api/email-cadence/[cadenceId]/start-countdown', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with day3Due and day7Due', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'approved' }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/start-countdown/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/start-countdown?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('day3Due')
    expect(body).toHaveProperty('day7Due')
  })

  it('returns 422 when cadence not in approved state', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'pending_approval' }]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/start-countdown/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/start-countdown?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(422)
  })

  it('returns 404 when cadence not found', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/start-countdown/route')
    const req = new Request('http://localhost/api/email-cadence/unknown/start-countdown?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'unknown' }) })
    expect(res.status).toBe(404)
  })
})
