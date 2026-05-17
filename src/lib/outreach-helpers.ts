import type { OutreachStatus } from '@/types/candidate'

export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  pending:           'Pending',
  discovering:       'Finding contact…',
  enriching:         'Enriching profile…',
  generating:        'Generating notes…',
  notes_ready:       'Select & Send',
  sent:              'Sent · Pending',
  queued:            'Queued — sends tomorrow',
  accepted:          'Connected ✓',
  expired:           'No response (expired)',
  paused:            'LinkedIn paused',
  no_contact_found:  'No contact found',
  skipped_dnc:       'Do-not-contact',
  failed:            'Generation failed',
}

export const OUTREACH_STATUS_BADGE_VARIANT: Record<OutreachStatus, string> = {
  pending:           'bg-gray-100 text-gray-400',
  discovering:       'bg-blue-50 text-blue-500',
  enriching:         'bg-blue-50 text-blue-500',
  generating:        'bg-blue-50 text-blue-500',
  notes_ready:       'bg-blue-100 text-blue-800',
  sent:              'bg-yellow-100 text-yellow-800',
  queued:            'bg-yellow-100 text-yellow-700',
  accepted:          'bg-emerald-100 text-emerald-800',
  expired:           'bg-gray-100 text-gray-500',
  paused:            'bg-red-100 text-red-800',
  no_contact_found:  'bg-gray-100 text-gray-500',
  skipped_dnc:       'bg-gray-100 text-gray-500',
  failed:            'bg-red-100 text-red-700',
}

export function isTransientOutreachStatus(status: OutreachStatus): boolean {
  return ['pending', 'discovering', 'enriching', 'generating'].includes(status)
}
