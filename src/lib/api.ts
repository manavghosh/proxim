import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function getCV(): Promise<CandidateState> {
  return request('/api/cv')
}

export async function convertCV(file: File): Promise<{ markdown: string }> {
  const form = new FormData()
  form.append('file', file)
  return request('/api/cv/convert', { method: 'POST', body: form })
}

export async function saveCV(markdown: string): Promise<CandidateState> {
  return request('/api/cv/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  })
}

export async function getPreferences(): Promise<{ preferences: Preferences }> {
  return request('/api/preferences')
}

export async function updatePreferences(
  updates: Partial<Preferences>
): Promise<{ preferences: Preferences }> {
  return request('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export async function getReadiness(): Promise<PipelineReadiness> {
  return request('/api/candidate/readiness')
}
