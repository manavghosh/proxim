'use client'

import { useEffect, useState } from 'react'
import { Mail, Zap, ShieldOff, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPreferences, updatePreferences, revokeGmailAccess, getGmailStatus } from '@/lib/api'
import type { EmailOutreachMode } from '@/types/candidate'

interface GmailStatus {
  connected: boolean
  expired:   boolean
  email:     string | null
  expiry:    string | null
}

interface Props {
  candidateId: string
  /** flash=connected|error injected from OAuth redirect query param */
  flash?: string | null
}

export function EmailOutreachModeCard({ candidateId, flash }: Props) {
  const [currentMode,   setCurrentMode]   = useState<EmailOutreachMode>('manual')
  const [selectedMode,  setSelectedMode]  = useState<EmailOutreachMode>('manual')
  const [gmail,         setGmail]         = useState<GmailStatus | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    Promise.all([
      getPreferences(candidateId),
      getGmailStatus(candidateId),
    ]).then(([{ preferences }, gmailStatus]) => {
      const m = preferences.email_outreach_mode ?? 'manual'
      setCurrentMode(m)
      setSelectedMode(m)
      setGmail(gmailStatus)
      setLoading(false)
    })
  }, [candidateId])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      if (currentMode === 'agentic' && selectedMode === 'manual') {
        // Switching Agentic → Manual: revoke and clear all Gmail tokens
        await revokeGmailAccess(candidateId)
        setGmail({ connected: false, expired: false, email: null, expiry: null })
      } else {
        await updatePreferences({ email_outreach_mode: selectedMode }, candidateId)
      }
      setCurrentMode(selectedMode)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const isDirty            = selectedMode !== currentMode
  const switchingToManual  = currentMode === 'agentic' && selectedMode === 'manual'
  const gmailConnected     = gmail?.connected ?? false
  const agenticWarn        = selectedMode === 'agentic' && !gmailConnected
  const connectHref        = `/api/gmail/connect?candidateId=${encodeURIComponent(candidateId)}`

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-muted-foreground" />
        <p className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase">
          Email Outreach
        </p>
      </div>

      {/* Flash messages from OAuth redirect */}
      {flash === 'connected' && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Gmail connected successfully.
        </div>
      )}
      {flash === 'error' && (
        <div className="flex items-center gap-2 rounded-lg bg-red-950/40 border border-red-800/40 px-3 py-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Gmail authorisation failed. Please try again.
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          {/* Manual option */}
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            selectedMode === 'manual' ? 'border-blue-500 bg-blue-950/20' : 'border-border hover:border-border-strong'
          }`}>
            <input
              type="radio"
              name="outreach-mode"
              value="manual"
              checked={selectedMode === 'manual'}
              onChange={() => setSelectedMode('manual')}
              data-testid="mode-manual"
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">Manual</span>
                <span className="text-[9px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 rounded px-1.5 py-0.5">
                  Recommended
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Proxim generates drafts. You review and send from your own Gmail.
                No Gmail authorisation required.
              </p>
            </div>
          </label>

          {/* Agentic option */}
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            selectedMode === 'agentic' ? 'border-blue-500 bg-blue-950/20' : 'border-border hover:border-border-strong'
          }`}>
            <input
              type="radio"
              name="outreach-mode"
              value="agentic"
              checked={selectedMode === 'agentic'}
              onChange={() => setSelectedMode('agentic')}
              data-testid="mode-agentic"
              className="mt-0.5 accent-blue-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-medium text-foreground">Agentic</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Proxim sends automatically via Gmail API.
              </p>

              {/* Gmail connected state */}
              {gmailConnected && gmail?.email && (
                <div className="flex items-center gap-1.5 mt-2">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="text-[10px] text-emerald-400">
                    Connected as {gmail.email}
                  </span>
                </div>
              )}

              {/* Gmail expired */}
              {gmail?.expired && (
                <div className="flex items-center gap-1.5 mt-2">
                  <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="text-[10px] text-amber-400">
                    Session expired —
                  </span>
                  <a href={connectHref} className="text-[10px] text-blue-400 hover:underline">
                    reconnect Gmail
                  </a>
                </div>
              )}

              {/* Connect Gmail button — shown when not connected */}
              {!gmailConnected && !gmail?.expired && (
                <Button
                  asChild
                  size="sm"
                  className="mt-2 text-[10px] h-7 bg-[#0A66C2] hover:bg-[#004182] text-white gap-1.5"
                  data-testid="connect-gmail-btn"
                >
                  <a href={connectHref}>
                    <Mail className="w-3 h-3" />
                    Connect Gmail to enable
                  </a>
                </Button>
              )}
            </div>
          </label>

          {/* Revoke warning when switching Agentic → Manual */}
          {switchingToManual && (
            <div
              className="flex items-start gap-2 rounded-lg border border-red-800/40 bg-red-950/20 p-3"
              data-testid="revoke-warning"
            >
              <ShieldOff className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-300">
                Switching to Manual will revoke Gmail access and permanently delete
                your stored Gmail credentials. You will need to reconnect Gmail if
                you switch back to Agentic.
              </p>
            </div>
          )}

          {selectedMode === 'agentic' && gmailConnected && !switchingToManual && (
            <p className="text-[10px] text-muted-foreground">
              Proxim will auto-send Day 1 emails and schedule Day 3/7 for approved cadences.
            </p>
          )}

          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || (selectedMode === 'agentic' && !gmailConnected)}
            isLoading={saving}
            data-testid="save-mode-btn"
            className={`text-xs ${switchingToManual ? 'bg-red-700 hover:bg-red-800 text-white' : ''}`}
          >
            {saved
              ? 'Saved ✓'
              : switchingToManual
              ? 'Revoke Gmail & Switch to Manual'
              : 'Save'}
          </Button>

          {selectedMode === 'agentic' && !gmailConnected && (
            <p className="text-[10px] text-muted-foreground">
              Connect Gmail above to enable Agentic mode.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
