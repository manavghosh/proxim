import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
}))
vi.mock('@/db/schema', () => ({
  candidates:      { id: 'id', preferences: 'preferences' },
  outreachTargets: {
    id: 'id', candidateId: 'candidateId', jobId: 'jobId', status: 'status',
    noteA: 'noteA', noteB: 'noteB', selectedNote: 'selectedNote',
    editedNote: 'editedNote', sentAt: 'sentAt', linkedinInvitationId: 'linkedinInvitationId',
  },
}))

// drizzle-orm count() mock — returns a plain object (SQL expression placeholder)
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return { ...actual, count: () => ({ sql: 'count(*)' }) }
})

const FUTURE = new Date(Date.now() + 5_000_000_000).toISOString()
const CAND   = 'cand-1'
const TARGET = 'tgt-1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSelectOnce(dbSelect: any, rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain['from']    = vi.fn().mockReturnValue(chain)
  chain['where']   = vi.fn().mockReturnValue(chain)
  chain['orderBy'] = vi.fn().mockReturnValue(chain)
  chain['limit']   = vi.fn().mockResolvedValue(rows)
  chain['then']    = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject)
  dbSelect.mockReturnValueOnce(chain)
}

describe('POST /api/outreach/[targetId]/select-and-send', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with sent status when under daily limit', async () => {
    const { db } = await import('@/db')

    // 1. candidate prefs (not paused, has access token)
    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: false } }])
    // 2. outreach target (notes_ready, has noteA/noteB)
    mockSelectOnce(vi.mocked(db.select), [{ id: TARGET, candidateId: CAND, status: 'notes_ready', noteA: 'Note A', noteB: 'Note B', sentAt: null, linkedinUrl: 'https://linkedin.com/in/test-person' }])
    // 3. daily send count
    mockSelectOnce(vi.mocked(db.select), [{ count: 0 }])

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'inv-123' }),
    } as Response)

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'A' }) }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('sent')
  })

  it('returns 200 with queued status when daily limit reached', async () => {
    const { db } = await import('@/db')

    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: false } }])
    mockSelectOnce(vi.mocked(db.select), [{ id: TARGET, candidateId: CAND, status: 'notes_ready', noteA: 'A', noteB: 'B', sentAt: null }])
    mockSelectOnce(vi.mocked(db.select), [{ count: 20 }])   // limit hit

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'B' }) }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('queued')
  })

  it('returns 409 when target is already sent', async () => {
    const { db } = await import('@/db')

    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: false } }])
    mockSelectOnce(vi.mocked(db.select), [{ id: TARGET, candidateId: CAND, status: 'sent', noteA: 'A', noteB: 'B', sentAt: '2026-01-01' }])

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'A' }) }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })

    expect(res.status).toBe(409)
  })

  it('returns 403 when linkedin is paused', async () => {
    const { db } = await import('@/db')

    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: true } }])

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'A' }) }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })

    expect(res.status).toBe(403)
  })

  it('returns 422 when target is not in notes_ready status', async () => {
    const { db } = await import('@/db')

    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: false } }])
    mockSelectOnce(vi.mocked(db.select), [{ id: TARGET, candidateId: CAND, status: 'pending', noteA: null, noteB: null, sentAt: null }])

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'A' }) }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })

    expect(res.status).toBe(422)
  })

  it('uses edited note when provided', async () => {
    const { db } = await import('@/db')

    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: false } }])
    mockSelectOnce(vi.mocked(db.select), [{ id: TARGET, candidateId: CAND, status: 'notes_ready', noteA: 'Original A', noteB: 'Original B', sentAt: null, linkedinUrl: 'https://linkedin.com/in/test-person' }])
    mockSelectOnce(vi.mocked(db.select), [{ count: 0 }])

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'inv-456' }),
    } as Response)

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'A', editedNote: 'My custom note' }) }
    )
    const res = await POST(req, { params: Promise.resolve({ targetId: TARGET }) })

    expect(res.status).toBe(200)
    // Verify the fetch body included the edited note
    const fetchBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(fetchBody.message).toBe('My custom note')
  })

  it('includes LinkedIn-Version header in invitation API call', async () => {
    const { db } = await import('@/db')

    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: false } }])
    mockSelectOnce(vi.mocked(db.select), [{
      id: TARGET, candidateId: CAND, status: 'notes_ready',
      noteA: 'Note A', noteB: 'Note B', sentAt: null,
      linkedinUrl: 'https://linkedin.com/in/test-person',
    }])
    mockSelectOnce(vi.mocked(db.select), [{ count: 0 }])

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'inv-123' }),
    } as Response)

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'A' }) }
    )
    await POST(req, { params: Promise.resolve({ targetId: TARGET }) })

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchCall).toBeTruthy()
    const headers = fetchCall[1].headers as Record<string, string>
    expect(headers['LinkedIn-Version']).toMatch(/^\d{6}$/)
  })

  it('records selected note variant in DB', async () => {
    const { db } = await import('@/db')

    mockSelectOnce(vi.mocked(db.select), [{ preferences: { linkedin_access_token: 'tok', linkedin_paused: false } }])
    mockSelectOnce(vi.mocked(db.select), [{ id: TARGET, candidateId: CAND, status: 'notes_ready', noteA: 'Note A text', noteB: 'Note B text', sentAt: null, linkedinUrl: 'https://linkedin.com/in/test-person' }])
    mockSelectOnce(vi.mocked(db.select), [{ count: 0 }])

    const setMock = vi.fn().mockReturnThis()
    const updateChain = { set: setMock, where: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'inv-789' }),
    } as Response)

    const { POST } = await import('@/app/api/outreach/[targetId]/select-and-send/route')
    const req = new Request(
      `http://localhost/api/outreach/${TARGET}/select-and-send?candidateId=${CAND}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedNote: 'B' }) }
    )
    await POST(req, { params: Promise.resolve({ targetId: TARGET }) })

    // At some point, selectedNote='B' was written to DB
    const allSetCalls = setMock.mock.calls.flat()
    const hasSelectedNote = allSetCalls.some((arg: Record<string, unknown>) =>
      typeof arg === 'object' && arg !== null && arg['selectedNote'] === 'B'
    )
    expect(hasSelectedNote).toBe(true)
  })
})
