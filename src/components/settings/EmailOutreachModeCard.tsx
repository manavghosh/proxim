'use client'

import { useEffect, useState } from 'react'
import { Mail, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPreferences, updatePreferences } from '@/lib/api'
import type { EmailOutreachMode } from '@/types/candidate'

interface Props {
  candidateId: string
  gmailConnected?: boolean
}

export function EmailOutreachModeCard({ candidateId, gmailConnected = false }: Props) {
  const [mode, setMode]       = useState<EmailOutreachMode>('manual')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPreferences(candidateId).then(({ preferences }) => {
      setMode(preferences.email_outreach_mode ?? 'manual')
      setLoading(false)
    })
  }, [candidateId])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await updatePreferences({ email_outreach_mode: mode }, candidateId)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const agenticWarn = mode === 'agentic' && !gmailConnected

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-[#64748b]" />
        <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
          Email Outreach
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-[#475569]">Loading…</p>
      ) : (
        <div className="space-y-2">
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            mode === 'manual' ? 'border-blue-500 bg-blue-950/20' : 'border-[#1e2d4a] hover:border-[#2d4a6f]'
          }`}>
            <input
              type="radio"
              name="outreach-mode"
              value="manual"
              checked={mode === 'manual'}
              onChange={() => setMode('manual')}
              data-testid="mode-manual"
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#e2e8f0]">Manual</span>
                <span className="text-[9px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 rounded px-1.5 py-0.5">
                  Recommended
                </span>
              </div>
              <p className="text-[10px] text-[#64748b] mt-0.5">
                Proxim generates drafts. You review and send from your own Gmail.
                No Gmail authorisation required.
              </p>
            </div>
          </label>

          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            mode === 'agentic' ? 'border-blue-500 bg-blue-950/20' : 'border-[#1e2d4a] hover:border-[#2d4a6f]'
          }`}>
            <input
              type="radio"
              name="outreach-mode"
              value="agentic"
              checked={mode === 'agentic'}
              onChange={() => setMode('agentic')}
              data-testid="mode-agentic"
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-medium text-[#e2e8f0]">Agentic</span>
              </div>
              <p className="text-[10px] text-[#64748b] mt-0.5">
                Proxim sends automatically via Gmail API.
                Requires Gmail authorisation in settings.
              </p>
            </div>
          </label>

          {agenticWarn && (
            <p className="text-[10px] text-amber-400 flex items-center gap-1" data-testid="gmail-not-connected-warning">
              ⚠ Connect Gmail above before enabling agentic mode.
            </p>
          )}

          {mode === 'agentic' && gmailConnected && (
            <p className="text-[10px] text-[#475569]">
              Proxim will resume auto-sending any pending Day 3/7 emails.
            </p>
          )}

          <Button size="sm" onClick={handleSave} isLoading={saving} data-testid="save-mode-btn" className="text-xs">
            {saved ? 'Saved ✓' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
