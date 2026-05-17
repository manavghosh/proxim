import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── DB mock ───────────────────────────────────────────────────────────────────
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  candidates:      { id: 'id', preferences: 'preferences' },
  outreachTargets: { candidateId: 'candidateId', status: 'status', sentAt: 'sentAt' },
}))

// ── Env ───────────────────────────────────────────────────────────────────────
vi.stubEnv('LINKEDIN_CLIENT_ID', 'test-client-id')
vi.stubEnv('LINKEDIN_CLIENT_SECRET', 'test-client-secret')
vi.stubEnv('LINKEDIN_REDIRECT_URI', 'http://localhost:3000/api/linkedin/callback')

// ── Shared DB mock helpers ────────────────────────────────────────────────────
function mockSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain['from']  = vi.fn().mockReturnValue(chain)
  chain['where'] = vi.fn().mockReturnValue(chain)
  chain['limit'] = vi.fn().mockResolvedValue(rows)
  // Thenable so the route can await .from().where() without .limit()
  chain['then']  = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject)
  return chain
}

function mockUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }
  return chain
}

// ── GET /api/linkedin/connect ─────────────────────────────────────────────────
describe('GET /api/linkedin/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('redirects to LinkedIn authorization URL', async () => {
    const { GET } = await import('@/app/api/linkedin/connect/route')
    const req = new Request('http://localhost/api/linkedin/connect?candidateId=cand-1')
    const res = await GET(req)

    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('https://www.linkedin.com/oauth/v2/authorization')
    expect(location).toContain('client_id=test-client-id')
    expect(location).toContain('redirect_uri=')
    expect(location).toContain('response_type=code')
    expect(location).toContain('scope=')
  })

  it('encodes candidateId in state param', async () => {
    const { GET } = await import('@/app/api/linkedin/connect/route')
    const req = new Request('http://localhost/api/linkedin/connect?candidateId=cand-abc')
    const res = await GET(req)

    const location = res.headers.get('location') ?? ''
    const url = new URL(location)
    const state = url.searchParams.get('state') ?? ''
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    expect(decoded.candidateId).toBe('cand-abc')
  })

  it('returns 400 when candidateId is missing', async () => {
    const { GET } = await import('@/app/api/linkedin/connect/route')
    const req = new Request('http://localhost/api/linkedin/connect')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })
})

// ── GET /api/linkedin/callback ────────────────────────────────────────────────
describe('GET /api/linkedin/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function makeState(candidateId: string) {
    return Buffer.from(JSON.stringify({ candidateId, ts: Date.now() })).toString('base64url')
  }

  it('exchanges code for token and redirects to settings', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue(
      mockSelectChain([{ preferences: { seniority_levels: ['Senior'] } }]) as never
    )
    vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'tok-123',
          expires_in: 5183999,
          refresh_token: 'ref-456',
          refresh_token_expires_in: 31536000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Jane Doe', given_name: 'Jane', family_name: 'Doe' }),
      } as Response)

    const state = makeState('cand-1')
    const { GET } = await import('@/app/api/linkedin/callback/route')
    const req = new Request(`http://localhost/api/linkedin/callback?code=auth-code&state=${state}`)
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/candidates/cand-1/settings')
    expect(res.headers.get('location')).toContain('linkedin=connected')

    // Token was persisted
    expect(vi.mocked(db.update).mock.calls.length).toBeGreaterThan(0)
    const setArg = vi.mocked(db.update).mock.results[0].value.set.mock.calls[0][0]
    expect(setArg.preferences.linkedin_access_token).toBe('tok-123')
    expect(setArg.preferences.linkedin_profile_name).toBe('Jane Doe')
    expect(setArg.preferences.seniority_levels).toEqual(['Senior']) // existing prefs preserved
  })

  it('redirects to settings with error when LinkedIn denies', async () => {
    const state = makeState('cand-1')
    const { GET } = await import('@/app/api/linkedin/callback/route')
    const req = new Request(
      `http://localhost/api/linkedin/callback?error=access_denied&state=${state}`
    )
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('linkedin=error')
  })

  it('redirects to settings with error when token exchange fails', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue(
      mockSelectChain([{ preferences: {} }]) as never
    )

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      text: async () => 'invalid_grant',
    } as Response)

    const state = makeState('cand-1')
    const { GET } = await import('@/app/api/linkedin/callback/route')
    const req = new Request(`http://localhost/api/linkedin/callback?code=bad-code&state=${state}`)
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('linkedin=error')
  })

  it('returns 400 when state is missing', async () => {
    const { GET } = await import('@/app/api/linkedin/callback/route')
    const req = new Request('http://localhost/api/linkedin/callback?code=auth-code')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when candidate not found', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as never)

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    } as Response)

    const state = makeState('unknown-cand')
    const { GET } = await import('@/app/api/linkedin/callback/route')
    const req = new Request(`http://localhost/api/linkedin/callback?code=auth-code&state=${state}`)
    const res = await GET(req)
    expect(res.status).toBe(404)
  })
})

// ── GET /api/linkedin/status ──────────────────────────────────────────────────
describe('GET /api/linkedin/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns connected=true when valid token is stored', async () => {
    const { db } = await import('@/db')
    const futureExpiry = new Date(Date.now() + 86400_000).toISOString()
    vi.mocked(db.select).mockReturnValue(
      mockSelectChain([{
        preferences: {
          linkedin_access_token: 'tok-123',
          linkedin_token_expires_at: futureExpiry,
          linkedin_profile_name: 'Jane Doe',
          linkedin_connected_at: '2026-01-01T00:00:00.000Z',
        },
      }]) as never
    )

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request('http://localhost/api/linkedin/status?candidateId=cand-1')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(true)
    expect(body.expired).toBe(false)
    expect(body.profileName).toBe('Jane Doe')
  })

  it('returns connected=false and expired=true when token is expired', async () => {
    const { db } = await import('@/db')
    const pastExpiry = new Date(Date.now() - 1000).toISOString()
    vi.mocked(db.select).mockReturnValue(
      mockSelectChain([{
        preferences: {
          linkedin_access_token: 'tok-old',
          linkedin_token_expires_at: pastExpiry,
        },
      }]) as never
    )

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request('http://localhost/api/linkedin/status?candidateId=cand-1')
    const res = await GET(req)
    const body = await res.json()

    expect(body.connected).toBe(false)
    expect(body.expired).toBe(true)
  })

  it('returns connected=false when no token stored', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue(
      mockSelectChain([{ preferences: { seniority_levels: ['Senior'] } }]) as never
    )

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request('http://localhost/api/linkedin/status?candidateId=cand-1')
    const res = await GET(req)
    const body = await res.json()

    expect(body.connected).toBe(false)
  })

  it('returns 400 when candidateId missing', async () => {
    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request('http://localhost/api/linkedin/status')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when candidate not found', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as never)

    const { GET } = await import('@/app/api/linkedin/status/route')
    const req = new Request('http://localhost/api/linkedin/status?candidateId=missing')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })
})

// ── POST /api/linkedin/disconnect ─────────────────────────────────────────────
describe('POST /api/linkedin/disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('removes LinkedIn token fields and preserves other preferences', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue(
      mockSelectChain([{
        preferences: {
          seniority_levels: ['Senior'],
          linkedin_access_token: 'tok-123',
          linkedin_profile_name: 'Jane Doe',
          linkedin_connected_at: '2026-01-01T00:00:00.000Z',
          linkedin_token_expires_at: '2026-04-01T00:00:00.000Z',
        },
      }]) as never
    )
    vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never)

    const { POST } = await import('@/app/api/linkedin/disconnect/route')
    const req = new Request('http://localhost/api/linkedin/disconnect?candidateId=cand-1', {
      method: 'POST',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.disconnected).toBe(true)

    const setArg = vi.mocked(db.update).mock.results[0].value.set.mock.calls[0][0]
    expect(setArg.preferences.seniority_levels).toEqual(['Senior'])
    expect(setArg.preferences.linkedin_access_token).toBeUndefined()
    expect(setArg.preferences.linkedin_profile_name).toBeUndefined()
  })

  it('returns 400 when candidateId missing', async () => {
    const { POST } = await import('@/app/api/linkedin/disconnect/route')
    const req = new Request('http://localhost/api/linkedin/disconnect', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when candidate not found', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as never)

    const { POST } = await import('@/app/api/linkedin/disconnect/route')
    const req = new Request('http://localhost/api/linkedin/disconnect?candidateId=ghost', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })
})
