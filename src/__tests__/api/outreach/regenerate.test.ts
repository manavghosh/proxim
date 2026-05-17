import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
}))
vi.mock('@/db/schema', () => ({
  outreachTargets: {
    id: 'id', candidateId: 'candidateId', status: 'status',
  },
  pipelineJobs: { id: 'id' },
}))

const CAND   = 'cand-1'
const TARGET = 'tgt-1'

describe('POST /api/outreach/[targetId]/regenerate', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 and queues a regeneration pipeline job', async () => {
    const { db } = await import('@/db')

    const selectChain = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: TARGET, candidateId: CAND, status: 'notes_ready' }]),
    }
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const insertChain = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: 'pj-1' }]) }
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const { POST } = await import('@/app/api/outreach/[targetId]/regenerate/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/regenerate?candidateId=${CAND}`,
      { method: 'POST' }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('generating')
    expect(body.targetId).toBe(TARGET)
  })

  it('returns 409 when target is already sent', async () => {
    const { db } = await import('@/db')

    const selectChain = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: TARGET, candidateId: CAND, status: 'sent' }]),
    }
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const { POST } = await import('@/app/api/outreach/[targetId]/regenerate/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/regenerate?candidateId=${CAND}`,
      { method: 'POST' }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })

    expect(res.status).toBe(409)
  })
})
