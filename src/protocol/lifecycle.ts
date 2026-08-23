import type { DeliveredHandoff } from './format.js'

export const HEADER_OWNERSHIP = {
  sender: ['id', 'from', 'to', 'priority', 'type', 'role', 'task', 'commit', 'artifacts', 'created_at'],
  delivery: ['recipient', 'enqueued_at'],
  dequeue: ['dequeued_at'],
  completion: ['completed_at'],
  approval: ['approved'],
} as const

type SenderHeader = (typeof HEADER_OWNERSHIP.sender)[number]
type SenderFields = Pick<DeliveredHandoff, SenderHeader>

export type SenderRecord = SenderFields & {
  readonly recipient?: string
  readonly enqueued_at?: string
  readonly dequeued_at?: string
  readonly completed_at?: string
  readonly approved?: true
}

export type DeliveryStamped = SenderRecord & { readonly recipient: string; readonly enqueued_at: string }
export type DequeueStamped = DeliveryStamped & { readonly dequeued_at: string }
export type CompletionStamped = DequeueStamped & { readonly completed_at: string }
export type ApprovalStamped<T extends SenderRecord = SenderRecord> = T & { readonly approved: true }

export function stampDelivery(record: SenderRecord, recipient: string, now: Date): DeliveryStamped {
  if (record.recipient !== undefined && record.enqueued_at !== undefined) return record as DeliveryStamped
  return { ...record, recipient: record.recipient ?? recipient, enqueued_at: record.enqueued_at ?? toIso(now) }
}

export function stampDequeue(record: DeliveryStamped, now: Date): DequeueStamped {
  if (record.dequeued_at !== undefined) return record as DequeueStamped
  return { ...record, dequeued_at: toIso(now) }
}

export function stampCompletion(record: DequeueStamped, now: Date): CompletionStamped {
  if (record.completed_at !== undefined) return record as CompletionStamped
  return { ...record, completed_at: toIso(now) }
}

export function stampApproval<T extends SenderRecord>(record: T): ApprovalStamped<T> {
  if (record.approved === true) return record as ApprovalStamped<T>
  return { ...record, approved: true }
}

function toIso(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('lifecycle timestamp must be a valid Date')
  return now.toISOString()
}
