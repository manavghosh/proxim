import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: { select: vi.fn(), update: vi.fn() },
}))
vi.mock('@/db/schema', () => ({
  candidates: { id: 'id', preferences: 'preferences' },
}))

const CAND = 'cand-1'

describe('POST /api/linkedin/resume', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('clears linkedin_paused flag and returns 200', async () => {
    const { db } = await import('@/db')

    const selectChain = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        preferences: { linkedin_access_token: 'tok', linkedin_paused: true, seniority_levels: ['Senior'] },
      }]),
    }
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const setMock = vi.fn().mockReturnThis()
    const updateChain = { set: setMock, where: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const { POST } = await import('@/app/api/linkedin/resume/route')
    const req = new Request(`http://localhost/api/linkedin/resume?candidateId=${CAND}`, { method: 'POST' })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.paused).toBe(false)

    // Verify linkedin_paused was set to false in the DB update
    const setArg = setMock.mock.calls[0][0]
    expect(setArg.preferences.linkedin_paused).toBe(false)
    // Other prefs preserved
    expect(setArg.preferences.seniority_levels).toEqual(['Senior'])
  })

  it('returns 400 when candidateId is missing', async () => {
    const { POST } = await import('@/app/api/linkedin/resume/route')
    const req = new Request('http://localhost/api/linkedin/resume', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 404 when candidate not found', async () => {
    const { db } = await import('@/db')
    const selectChain = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const { POST } = await import('@/app/api/linkedin/resume/route')
    const req = new Request(`http://localhost/api/linkedin/resume?candidateId=ghost`, { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBe(404)
  })
})
