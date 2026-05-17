import type { EmailCadenceStatus, EmailDraftStatus } from '@/types/candidate'

export const EMAIL_CADENCE_STATUS_LABELS: Record<EmailCadenceStatus, string> = {
  pending_discovery:  'Discovering email…',
  discovering:        'Discovering email…',
  low_confidence:     'Low confidence',
  email_not_found:    'Email not found',
  generating:         'Drafting emails…',
  pending_approval:   'Review & Approve',
  approved:           'Approved — sending soon',
  active:             'Cadence active',
  paused:             'Cadence paused',
  auth_expired:       'Gmail re-auth needed',
  attachment_missing: 'Awaiting resume PDF',
  replied:            'Reply received',
  cadence_complete:   'Cadence complete',
  bounced:            'Day 1 bounced',
  cancelled:          'Cancelled',
  failed:             'Failed',
}

export const EMAIL_CADENCE_BADGE_VARIANT: Record<EmailCadenceStatus, string> = {
  pending_discovery:  'bg-gray-100 text-gray-500',
  discovering:        'bg-gray-100 text-gray-500',
  low_confidence:     'bg-orange-100 text-orange-800',
  email_not_found:    'bg-gray-100 text-gray-500',
  generating:         'bg-gray-100 text-gray-500',
  pending_approval:   'bg-blue-100 text-blue-800',
  approved:           'bg-yellow-100 text-yellow-800',
  active:             'bg-yellow-100 text-yellow-800',
  paused:             'bg-yellow-100 text-yellow-800',
  auth_expired:       'bg-orange-100 text-orange-800',
  attachment_missing: 'bg-orange-100 text-orange-800',
  replied:            'bg-emerald-100 text-emerald-800',
  cadence_complete:   'bg-emerald-100 text-emerald-800',
  bounced:            'bg-red-100 text-red-800',
  cancelled:          'bg-gray-100 text-gray-500',
  failed:             'bg-red-100 text-red-800',
}

export const EMAIL_DRAFT_STATUS_LABELS: Record<EmailDraftStatus, string> = {
  draft:         'Draft',
  approved:      'Approved',
  superseded:    'Superseded',
  scheduled:     'Scheduled',
  sending:       'Sending…',
  sent:          'Sent',
  manually_sent: 'Sent',
  bounced:       'Bounced',
  rate_limited:  'Rate limited',
  cancelled:     'Cancelled',
}
