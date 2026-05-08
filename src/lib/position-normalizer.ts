const ACRONYMS = new Set([
  'vp', 'svp', 'evp', 'avp',
  'ceo', 'cto', 'cio', 'coo', 'cfo', 'cmo', 'cxo',
  'ai', 'ml', 'nlp', 'qa', 'pm', 'pmo', 'sde', 'sre',
  'it', 'hr', 'gm', 'cs', 'ux', 'ui', 'sdr', 'bdr',
  'caio', 'gcc',
])

const LOWERCASE_PREPS = new Set([
  'of', 'the', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'with', 'a', 'an',
])

const TRAILING_SEPARATORS = [',', ' - ', '—']

export function normalizePosition(rawTitle: string): string {
  const trimmed = rawTitle.trim()
  if (!trimmed) return 'Unknown'

  let head = trimmed
  for (const sep of TRAILING_SEPARATORS) {
    const idx = head.indexOf(sep)
    if (idx >= 0) head = head.slice(0, idx)
  }

  const tokens = head.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 'Unknown'

  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const lower = tok.toLowerCase().replace(/\.$/, '')

    if (lower === 'sr') {
      out.push('Senior')
      continue
    }
    if (lower === 'jr') {
      out.push('Junior')
      continue
    }

    if (ACRONYMS.has(lower)) {
      out.push(lower.toUpperCase())
      continue
    }

    if (i > 0 && LOWERCASE_PREPS.has(lower)) {
      out.push(lower)
      continue
    }

    out.push(titleCaseToken(tok))
  }

  return out.join(' ')
}

function titleCaseToken(tok: string): string {
  return tok
    .split('-')
    .map((seg) => (seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg))
    .join('-')
}

export interface PositionGroup {
  position: string
  rawTitles: string[]
  count: number
  jobIds: string[]
  sampleCompanies: string[]
}

export interface GroupedPositions {
  totalJobs: number
  groups: PositionGroup[]
}

interface JobLike {
  id: string
  title: string
  company: string
}

const SAMPLE_COMPANIES_LIMIT = 3

export function groupByPosition(jobs: JobLike[]): GroupedPositions {
  const buckets = new Map<string, PositionGroup>()

  for (const j of jobs) {
    const position = normalizePosition(j.title)
    let bucket = buckets.get(position)
    if (!bucket) {
      bucket = {
        position,
        rawTitles: [],
        count: 0,
        jobIds: [],
        sampleCompanies: [],
      }
      buckets.set(position, bucket)
    }

    bucket.count += 1
    bucket.jobIds.push(j.id)

    const rawTitle = j.title.trim() || j.title
    if (!bucket.rawTitles.includes(rawTitle)) {
      bucket.rawTitles.push(rawTitle)
    }

    if (
      j.company &&
      !bucket.sampleCompanies.includes(j.company) &&
      bucket.sampleCompanies.length < SAMPLE_COMPANIES_LIMIT
    ) {
      bucket.sampleCompanies.push(j.company)
    }
  }

  const groups = Array.from(buckets.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.position.localeCompare(b.position)
  })

  return { totalJobs: jobs.length, groups }
}
