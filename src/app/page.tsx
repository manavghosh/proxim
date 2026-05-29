'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCandidates, createCandidate, updateCandidateName } from '@/lib/api'
import type { CandidateSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

const PARSE_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  ready:   { label: 'Ready',   variant: 'default'     },
  parsing: { label: 'Parsing', variant: 'outline'     },
  failed:  { label: 'Failed',  variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary'   },
}

export default function RosterPage() {
  const router = useRouter()
  const [candidates, setCandidates] = useState<CandidateSummary[]>([])
  const [loading, setLoading]       = useState(true)
  const [creating, setCreating]     = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editName, setEditName]     = useState('')

  async function load() {
    try {
      const { candidates } = await getCandidates()
      setCandidates(candidates)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate() {
    setCreating(true)
    try {
      const { id } = await createCandidate('New Candidate')
      router.push(`/candidates/${id}/settings`)
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return
    await updateCandidateName(id, editName.trim())
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, name: editName.trim() } : c))
    setEditingId(null)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">P</span>
          </div>
          <span className="text-[15px] font-bold text-foreground tracking-widest">PROXIM</span>
        </div>
        <Button onClick={handleCreate} isLoading={creating}>
          + Add Candidate
        </Button>
      </header>

      <main className="px-8 py-8 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">All Candidates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl bg-card" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground text-sm mb-4">No candidates yet.</p>
            <Button onClick={handleCreate} isLoading={creating}>
              Add your first candidate
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {candidates.map((c) => {
              const parseBadge = PARSE_BADGE[c.parseStatus] ?? PARSE_BADGE.pending
              return (
                <Card key={c.id} className="p-5 gap-4">
                  {/* Top row */}
                  <div className="flex items-start gap-3">
                    <CandidateAvatar
                      name={c.name}
                      avatarData={c.avatarData}
                      size="md"
                      className="h-10 w-10 text-sm flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      {editingId === c.id ? (
                        <div className="flex gap-1.5">
                          <Input
                            autoFocus
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') void handleRename(c.id)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            className="h-7 text-sm bg-background border-border-strong text-foreground"
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-blue-400 hover:text-blue-300"
                            onClick={() => handleRename(c.id)}
                          >
                            Save
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          className="h-auto p-0 text-[13px] font-semibold text-foreground hover:text-blue-300 truncate justify-start w-full"
                          onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                          title="Click to rename"
                        >
                          {c.name}
                        </Button>
                      )}
                      <Badge variant={parseBadge.variant} className="text-[10px] mt-1">
                        {parseBadge.label}
                      </Badge>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-background rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Jobs Matched</p>
                      <p className="text-[18px] font-bold text-foreground mt-0.5">{c.jobsMatched}</p>
                    </div>
                    <div className="bg-background rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Applications</p>
                      <p className="text-[18px] font-bold text-foreground mt-0.5">{c.applications}</p>
                    </div>
                  </div>

                  {/* Open button */}
                  <Button
                    variant="outline"
                    className="w-full border-border-strong text-primary hover:bg-border-strong hover:text-primary"
                    onClick={() => router.push(`/candidates/${c.id}/dashboard`)}
                  >
                    Open Dashboard →
                  </Button>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
