// Single source of truth for the job lifecycle status badge (label + colour).
// Mirrors the lib/outreach-helpers + lib/email-cadence-helpers pattern.

export type JobLifecycleStatus =
  | 'approved'
  | 'resume_ready'
  | 'submitted'
  | 'resume_failed'
  | 'snoozed'
  | 'rejected'

export const JOB_STATUS_LABELS: Record<JobLifecycleStatus, string> = {
  approved: 'Approved',
  resume_ready: 'Resume ready',
  submitted: 'Submitted',
  resume_failed: 'Resume failed',
  snoozed: 'Snoozed',
  rejected: 'Rejected',
}

export const JOB_STATUS_BADGE_CLASS: Record<JobLifecycleStatus, string> = {
  approved: 'bg-emerald-600 text-white border-transparent',
  resume_ready: 'bg-blue-600 text-white border-transparent',
  submitted: 'bg-cyan-700 text-white border-transparent',
  resume_failed: 'bg-red-700 text-white border-transparent',
  snoozed: 'bg-border text-muted-foreground border-border-strong',
  rejected: 'bg-red-900/40 text-red-400 border-red-800/40',
}
