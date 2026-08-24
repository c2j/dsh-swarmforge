export const HANDOFF_PATHS = {
  ownerOutboxTmp: 'outbox/tmp',
  ownerOutboxSent: 'outbox/sent',
  ownerOutboxFailed: 'outbox/failed',
  inboxNew: 'inbox/new',
  inboxInProcess: 'inbox/in_process',
  inboxCompleted: 'inbox/completed',
  pendingApproval: 'pending_approval',
  projectOutbox: 'outbox',
} as const

export type HandoffPathName = keyof typeof HANDOFF_PATHS
export type HandoffPath = (typeof HANDOFF_PATHS)[HandoffPathName]
