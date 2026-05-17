import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: { select: vi.fn() },
}))
vi.mock('@/db/schema', () => ({
  outreachTargets: {
    id: 'id', candidateId: 'candidateId', jobId: 'jobId', status: 'status',
    name: 'name', linkedinUrl: 'linkedinUrl', title: 'title', seniority: 'seniority',
    noteA: 'noteA', noteB: 'noteB', selectedNote: 'selectedNote', editedNote: 'editedNote',
    company: 'company', enrichmentJson: 'enrichmentJson',
    sentAt: 'sentAt', acceptedAt: 'acceptedAt', errorMessage: 'errorMessage',
  },
  jobs: { id: 'id', candidateId: 'candidateId', company: 'company' },
}))

const CAND   = 'cand-1'
const TARGET = 'tgt-1'

const FULL_TARGET = {
  id: TARGET, candidateId: CAND, jobId: 'job-1', status: 'notes_ready',
  name: 'Alice Zhang', linkedinUrl: 'https://linkedin.com/in/alice', title: 'CTO',
  seniority: 'CTO', noteA: 'Note A', noteB: 'Note B', selectedNote: null,
  editedNote: null, company: 'Acme Corp', enrichmentJson: null,
  sentAt: null, acceptedAt: null, errorMessage: null,
}

describe('GET /api/outreach/[targetId]', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with full outreach target', async () => {
    const { db } = await import('@/db')
    const chain = {
      from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([FULL_TARGET]),
    }
    vi.mocked(db.select).mockReturnValue(chain as never)

    const { GET } = await import('@/app/api/outreach/[targetId]/route')
    const req = new Request(`http://localhost/api/outreach/${TARGET}?candidateId=${CAND}`)
    const res = await GET(req, { params: Promise.resolve({ targetId: TARGET }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.id).toBe(TARGET)
    expect(body.status).toBe('notes_ready')
    expect(body.name).toBe('Alice Zhang')
  })

  it('returns 404 for unknown target', async () => {
    const { db } = await import('@/db')
    const chain = {
      from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(db.select).mockReturnValue(chain as never)

    const { GET } = await import('@/app/api/outreach/[targetId]/route')
    const req = new Request(`http://localhost/api/outreach/unknown?candidateId=${CAND}`)
    const res = await GET(req, { params: Promise.resolve({ targetId: 'unknown' }) })

    expect(res.status).toBe(404)
  })

  it('returns 403 for wrong candidate', async () => {
    const { db } = await import('@/db')
    const chain = {
      from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ ...FULL_TARGET, candidateId: 'different-cand' }]),
    }
    vi.mocked(db.select).mockReturnValue(chain as never)

    const { GET } = await import('@/app/api/outreach/[targetId]/route')
    const req = new Request(`http://localhost/api/outreach/${TARGET}?candidateId=${CAND}`)
    const res = await GET(req, { params: Promise.resolve({ targetId: TARGET }) })

    expect(res.status).toBe(403)
  })

  it('returns 400 when candidateId is missing', async () => {
    const { GET } = await import('@/app/api/outreach/[targetId]/route')
    const req = new Request(`http://localhost/api/outreach/${TARGET}`)
    const res = await GET(req, { params: Promise.resolve({ targetId: TARGET }) })

    expect(res.status).toBe(400)
  })
})
