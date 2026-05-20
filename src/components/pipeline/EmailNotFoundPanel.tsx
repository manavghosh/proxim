'use client'

import { useState } from 'react'
import { Mail, ExternalLink, X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { overrideEmail, cancelCadence, startEmailOutreach } from '@/lib/api'
import type { EmailCadenceSummary, OutreachTargetSummary } from '@/types/candidate'

interface Props {
  jobId: string
  candidateId: string
  cadence: EmailCadenceSummary
  company: string
  outreachTarget: OutreachTargetSummary | null
  onUpdate: () => void
}

export function EmailNotFoundPanel({ jobId, candidateId, cadence, company, outreachTarget, onUpdate }: Props) {
  // Bug 4: pre-fill with the low-confidence email so the user can confirm or replace it
  const [showInput, setShowInput]   = useState(false)
  const [emailValue, setEmailValue] = useState(
    cadence.status === 'low_confidence' ? (cadence.hiringManagerEmail ?? '') : ''
  )
  const [saving, setSaving]         = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [retrying, setRetrying]     = useState(false)
  const [retryMaxed, setRetryMaxed] = useState((cadence.retryCount ?? 0) >= 2)
  const retryCount                  = cadence.retryCount ?? 0
  const [error, setError]           = useState<string | null>(null)

  // Bug 2: message variant for each triggering status
  const message =
    cadence.status === 'low_confidence' ? `Email found but could not be verified for ${company}` :
    cadence.status === 'failed'         ? `Email outreach could not be completed for ${company}` :
                                          `No email found for ${company}`

  const emailValid = emailValue.includes('@') && emailValue.includes('.')

  async function handleSave() {
    if (!emailValid) return
    setSaving(true)
    setError(null)
    try {
      await overrideEmail(cadence.id, candidateId, emailValue)
      onUpdate()
    } catch (e) {
      // Bug 5: 409 means the agent is actively running discovery — give a clear message
      if (e instanceof Error && e.message.startsWith('409')) {
        setError('Discovery is in progress — please wait a moment and try again')
      } else {
        setError('Failed to save — please try again')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSkip() {
    setCancelling(true)
    try {
      await cancelCadence(cadence.id, candidateId)
      onUpdate()
    } finally {
      setCancelling(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    setError(null)
    try {
      await startEmailOutreach(jobId, candidateId)
      onUpdate()
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('429')) {
        setRetryMaxed(true)
      } else {
        setError('Retry failed — please try again')
      }
    } finally {
      setRetrying(false)
    }
  }

  function handleCancel() {
    setShowInput(false)
    setEmailValue('')
  }

  return (
    <div className="mt-1 space-y-2">
      <p className="text-[11px] text-[#64748b]">{message}</p>

      {!showInput ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
            onClick={() => setShowInput(true)}
          >
            <Mail className="w-3 h-3" />
            Enter email
          </Button>

          {outreachTarget?.linkedinUrl && (
            <a
              href={outreachTarget.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-6 px-2 text-[10px] rounded-md border border-[#1e3a5f] text-[#94a3b8] hover:bg-[#1e3a5f] transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Use LinkedIn
            </a>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-[#475569] hover:text-[#94a3b8] gap-1"
            onClick={handleSkip}
            isLoading={cancelling}
          >
            <X className="w-3 h-3" />
            Skip
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-[#334155] hover:text-[#64748b] gap-1 ml-auto"
            onClick={handleRetry}
            disabled={retryMaxed || retrying}
            isLoading={retrying}
          >
            <RotateCcw className="w-3 h-3" />
            {retryMaxed ? 'Max retries reached' : `Retry (${retryCount}/2)`}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={emailValue}
            onChange={e => setEmailValue(e.target.value)}
            placeholder="hiring@company.com"
            className="h-7 text-[11px] bg-[#060d1f] border-[#2d4a6e] text-[#f1f5f9] flex-1"
            onKeyDown={e => {
              if (e.key === 'Enter') void handleSave()
              if (e.key === 'Escape') void handleCancel()
            }}
          />
          <Button
            size="sm"
            className="h-7 text-[10px] bg-blue-600 hover:bg-blue-700 text-white shrink-0"
            onClick={handleSave}
            disabled={!emailValid || saving}
            isLoading={saving}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] text-[#475569] shrink-0"
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
