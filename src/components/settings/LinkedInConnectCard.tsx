'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}
import { Button } from '@/components/ui/button'

interface LinkedInStatus {
  connected: boolean
  expired: boolean
  profileName: string | null
  connectedAt: string | null
}

interface Props {
  candidateId: string
  /** flash=connected|error|expired injected from OAuth redirect query param */
  flash?: string | null
}

export function LinkedInConnectCard({ candidateId, flash }: Props) {
  const [status, setStatus]         = useState<LinkedInStatus | null>(null)
  const [loading, setLoading]       = useState(true)
  const [disconnecting, setDiscon]  = useState(false)

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/linkedin/status?candidateId=${encodeURIComponent(candidateId)}`)
      if (res.ok) setStatus(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStatus() }, [candidateId])

  async function handleDisconnect() {
    setDiscon(true)
    try {
      await fetch(`/api/linkedin/disconnect?candidateId=${encodeURIComponent(candidateId)}`, {
        method: 'POST',
      })
      setStatus({ connected: false, expired: false, profileName: null, connectedAt: null })
    } finally {
      setDiscon(false)
    }
  }

  const connectHref = `/api/linkedin/connect?candidateId=${encodeURIComponent(candidateId)}`

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <LinkedInIcon className="w-4 h-4 text-[#0A66C2]" />
        <p className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase">
          LinkedIn
        </p>
      </div>

      {flash === 'connected' && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          LinkedIn connected successfully.
        </div>
      )}
      {flash === 'error' && (
        <div className="flex items-center gap-2 rounded-lg bg-red-950/40 border border-red-800/40 px-3 py-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          LinkedIn authorisation failed. Please try again.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Checking connection…
        </div>
      ) : status?.connected ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Connected as <span className="font-medium">{status.profileName}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-border-strong text-primary hover:bg-card"
            onClick={handleDisconnect}
            isLoading={disconnecting}
          >
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {status?.expired && (
            <p className="text-xs text-amber-400">Your LinkedIn token has expired.</p>
          )}
          <Button
            asChild
            size="sm"
            className="bg-[#0A66C2] hover:bg-[#004182] text-white text-xs"
          >
            <a href={connectHref}>
              <LinkedInIcon className="w-3.5 h-3.5 mr-1.5" />
              Connect LinkedIn
            </a>
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Authorise Proxim to send connection requests on your behalf.
          </p>
        </div>
      )}
    </div>
  )
}
