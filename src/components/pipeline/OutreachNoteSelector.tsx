'use client'

import { useState } from 'react'
import { AlertCircle, RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { selectAndSendNote, regenerateNotes, retryLinkedIn } from '@/lib/api'
import type { OutreachTargetSummary, OutreachStatus } from '@/types/candidate'

interface Props {
  target:         OutreachTargetSummary
  candidateId:    string
  jobId:          string
  onStatusChange: (newStatus: OutreachStatus) => void
}

export function OutreachNoteSelector({ target, candidateId, jobId, onStatusChange }: Props) {
  const [activeTab,    setActiveTab]    = useState<'A' | 'B'>('A')
  const [editedText,   setEditedText]   = useState('')
  const [sending,      setSending]      = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [retrying,     setRetrying]     = useState(false)
  const [resultStatus, setResultStatus] = useState<OutreachStatus | null>(null)
  const [sendError,    setSendError]    = useState<string | null>(null)

  const effectiveStatus = resultStatus ?? target.status

  // ── LinkedIn paused ────────────────────────────────────────────────────────
  if (effectiveStatus === 'paused') {
    return (
      <div
        className="flex items-center gap-2 rounded-lg bg-red-950/40 border border-red-800/40 px-3 py-2 text-xs text-red-400"
        data-testid="linkedin-paused-banner"
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        LinkedIn outreach is paused due to rate limiting. Resume in settings.
      </div>
    )
  }

  // ── No contact found ──────────────────────────────────────────────────────
  if (effectiveStatus === 'no_contact_found') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-[#64748b]">
          No hiring manager found at this company via LinkedIn search.
        </p>
        <Button
          size="sm" variant="outline"
          className="text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
          isLoading={retrying}
          data-testid="linkedin-retry-btn"
          onClick={async () => {
            setRetrying(true)
            try {
              await retryLinkedIn(jobId, candidateId)
              setResultStatus('discovering')
              onStatusChange('discovering')
            } finally { setRetrying(false) }
          }}
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Retry LinkedIn search
        </Button>
      </div>
    )
  }

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (effectiveStatus === 'failed') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-red-400">Note generation failed.</p>
        <Button
          size="sm" variant="outline"
          className="text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
          isLoading={regenerating}
          data-testid="note-regenerate-btn"
          onClick={async () => {
            setRegenerating(true)
            try {
              const r = await regenerateNotes(target.id, candidateId)
              setResultStatus(r.status as OutreachStatus)
              onStatusChange(r.status as OutreachStatus)
            } finally { setRegenerating(false) }
          }}
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Regenerate notes
        </Button>
      </div>
    )
  }

  // ── Queued / sent ──────────────────────────────────────────────────────────
  if (effectiveStatus === 'queued') {
    return <p className="text-xs text-amber-400">Queued — daily limit reached. Sends tomorrow.</p>
  }
  if (effectiveStatus === 'sent' || effectiveStatus === 'accepted') {
    return (
      <p className="text-xs text-emerald-400">
        {effectiveStatus === 'accepted' ? 'Connection accepted ✓' : 'Sent · Pending acceptance'}
      </p>
    )
  }

  // ── Note tabs (notes_ready) ────────────────────────────────────────────────
  const activeNote  = activeTab === 'A' ? target.noteA : target.noteB
  const displayText = editedText || activeNote || ''
  const charCount   = (editedText || activeNote || '').length
  const overLimit   = charCount > 300

  async function handleSend() {
    setSending(true)
    setSendError(null)
    try {
      const result = await selectAndSendNote(
        target.id, candidateId, activeTab, editedText || undefined
      )
      setResultStatus(result.status)
      onStatusChange(result.status)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Surface a readable message — strip the leading status code if present
      const readable = msg.replace(/^\d+:\s*/, '')
      let parsed: { error?: string } | null = null
      try { parsed = JSON.parse(readable) } catch { /* not JSON */ }
      setSendError(parsed?.error ?? 'Failed to send connection request. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'A' | 'B'); setEditedText('') }}>
        <TabsList className="w-full">
          <TabsTrigger value="A" className="flex-1 flex-col gap-0 py-2" data-testid="note-variant-a">
            <span className="text-[11px] font-semibold">Note A</span>
            <span className="text-[9px] opacity-60">Personalised</span>
          </TabsTrigger>
          <TabsTrigger value="B" className="flex-1 flex-col gap-0 py-2" data-testid="note-variant-b">
            <span className="text-[11px] font-semibold">Note B</span>
            <span className="text-[9px] opacity-60">Alternative</span>
          </TabsTrigger>
        </TabsList>

        {(['A', 'B'] as const).map(tab => (
          <TabsContent key={tab} value={tab} forceMount
            className={tab !== activeTab ? 'hidden' : ''}>
            <div className="rounded-lg border border-[#1e3a5f] bg-[#0d1829] p-3 text-xs text-[#94a3b8] leading-relaxed min-h-[60px]">
              {tab === 'A' ? target.noteA : target.noteB}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Edit textarea */}
      <div className="space-y-1">
        <Textarea
          className="text-xs bg-[#0d1829] border-[#1e3a5f] text-[#cbd5e1] resize-none placeholder:text-[#334155]"
          rows={2}
          placeholder="Edit note (optional)…"
          value={editedText}
          onChange={e => setEditedText(e.target.value)}
          data-testid="note-edit-textarea"
        />
        <div className="flex justify-end">
          <span className={`text-[10px] ${overLimit ? 'text-red-400' : 'text-[#475569]'}`}>
            {charCount}/300
          </span>
        </div>
      </div>

      <Button
        size="sm"
        className="bg-[#0A66C2] hover:bg-[#004182] text-white text-xs w-full"
        disabled={overLimit}
        isLoading={sending}
        onClick={handleSend}
        data-testid="note-send-btn"
      >
        <Send className="w-3 h-3 mr-1.5" />
        Send connection request
      </Button>

      {sendError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-950/40 border border-red-800/40 px-3 py-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{sendError}</span>
        </div>
      )}
    </div>
  )
}
