import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: { select: vi.fn() },
}))
vi.mock('@/db/schema', () => ({
  candidates:      { id: 'id', preferences: 'preferences' },
  outreachTargets: { candidateId: 'candidateId', status: 'status', sentAt: 'sentAt' },
}))

const CAND = 'cand-1'
const FUTURE = new Date(Date.now() + 5_000_000_000).toISOString()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSelect(dbSelect: any, ...rowSets: unknown[][]) {
  rowSets.forEach(rows => {
    const chain: Record<string, unknown> = {}
    chain['from']    = vi.fn().mockReturnValue(chain)
    chain['where']   = vi.fn().mockReturnValue(chain)
    chain['orderBy'] = vi.fn().mockReturnValue(chain)
    chain['limit']   = vi.fn().mockResolvedValue(rows)
    chain['then']    = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject)
    dbSelect.mockReturnValueOnce(chain)
  })
}

describe('GET /api/linkedin/status (extended)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns connected=true and paused=false when valid token present', async () => {
    const { db } = await import('@/db')
    mockSelect(vi.mocked(db.select),
      [{ preferences: { linkedin_access_token: 'tok', linkedin_token_expires_at: FUTURE, linkedin_paused: false, do_not_contact_companies: [] } }],
      [{ count: 3 }],   // daily sends
      [{ count: 1 }],   // queued
    )

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request(`http://localhost/api/linkedin/status?candidateId=${CAND}`)
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(true)
    expect(body.paused).toBe(false)
  })

  it('returns dailySendsToday count from outreach_targets', async () => {
    const { db } = await import('@/db')
    mockSelect(vi.mocked(db.select),
      [{ preferences: { linkedin_access_token: 'tok', linkedin_token_expires_at: FUTURE, linkedin_paused: false, do_not_contact_companies: [] } }],
      [{ count: 7 }],
      [{ count: 0 }],
    )

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request(`http://localhost/api/linkedin/status?candidateId=${CAND}`)
    const res = await GET(req)
    const body = await res.json()

    expect(body.dailySendsToday).toBe(7)
    expect(body.dailyLimit).toBe(20)
  })

  it('returns paused=true when linkedin_paused flag is set', async () => {
    const { db } = await import('@/db')
    mockSelect(vi.mocked(db.select),
      [{ preferences: { linkedin_access_token: 'tok', linkedin_token_expires_at: FUTURE, linkedin_paused: true, do_not_contact_companies: [] } }],
      [{ count: 0 }],
      [{ count: 0 }],
    )

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request(`http://localhost/api/linkedin/status?candidateId=${CAND}`)
    const res = await GET(req)
    const body = await res.json()

    expect(body.paused).toBe(true)
  })

  it('returns queuedCount from outreach_targets', async () => {
    const { db } = await import('@/db')
    mockSelect(vi.mocked(db.select),
      [{ preferences: { linkedin_access_token: 'tok', linkedin_token_expires_at: FUTURE, linkedin_paused: false, do_not_contact_companies: [] } }],
      [{ count: 2 }],
      [{ count: 5 }],
    )

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request(`http://localhost/api/linkedin/status?candidateId=${CAND}`)
    const res = await GET(req)
    const body = await res.json()

    expect(body.queuedCount).toBe(5)
  })
})
