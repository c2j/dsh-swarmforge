import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  HEADER_OWNERSHIP,
  HANDOFF_PATHS,
  stampApproval,
  stampCompletion,
  stampDelivery,
  stampDequeue,
  type DeliveryStamped,
  type SenderRecord,
} from '../../src/protocol/index.js'

const senderRecord: SenderRecord = {
  id: '20260823T121314Z_000007_from_architect', from: 'architect', to: 'coder', priority: '50',
  type: 'git_handoff', role: 'architect', task: 'Implement parser', commit: 'a1B2c3D4e5',
  artifacts: 'src/a.ts', created_at: '2026-08-23T12:13:14.000Z',
}

describe('header lifecycle ownership', () => {
  it('shouldExposeExactHeaderOwnershipByWriter', () => {
    expect(HEADER_OWNERSHIP).toEqual({
      sender: ['id', 'from', 'to', 'priority', 'type', 'role', 'task', 'commit', 'artifacts', 'created_at'],
      delivery: ['recipient', 'enqueued_at'],
      dequeue: ['dequeued_at'],
      completion: ['completed_at'],
      approval: ['approved'],
    })
  })

  it('shouldStampDeliveryImmutably', () => {
    const delivered = stampDelivery(senderRecord, 'coder', new Date('2026-08-23T12:14:00.000Z'))

    expect(delivered).toEqual({ ...senderRecord, recipient: 'coder', enqueued_at: '2026-08-23T12:14:00.000Z' })
    expect(senderRecord).not.toHaveProperty('recipient')
    expectTypeOf(delivered).toEqualTypeOf<DeliveryStamped>()
  })

  it('shouldPreserveExistingDeliveryStamp', () => {
    const delivered = stampDelivery(senderRecord, 'coder', new Date('2026-08-23T12:14:00.000Z'))

    expect(stampDelivery(delivered, 'other', new Date('2030-01-01T00:00:00.000Z'))).toBe(delivered)
  })

  it('shouldStampDequeueAddIfAbsent', () => {
    const delivered = stampDelivery(senderRecord, 'coder', new Date('2026-08-23T12:14:00.000Z'))
    const dequeued = stampDequeue(delivered, new Date('2026-08-23T12:15:00.000Z'))

    expect(dequeued.dequeued_at).toBe('2026-08-23T12:15:00.000Z')
    expect(stampDequeue(dequeued, new Date('2030-01-01T00:00:00.000Z'))).toBe(dequeued)
  })

  it('shouldStampCompletionAddIfAbsent', () => {
    const delivered = stampDelivery(senderRecord, 'coder', new Date('2026-08-23T12:14:00.000Z'))
    const dequeued = stampDequeue(delivered, new Date('2026-08-23T12:15:00.000Z'))
    const completed = stampCompletion(dequeued, new Date('2026-08-23T12:16:00.000Z'))

    expect(completed.completed_at).toBe('2026-08-23T12:16:00.000Z')
    expect(stampCompletion(completed, new Date('2030-01-01T00:00:00.000Z'))).toBe(completed)
  })

  it('shouldStampApprovalAddIfAbsent', () => {
    const approved = stampApproval(senderRecord)

    expect(approved.approved).toBe(true)
    expect(stampApproval(approved)).toBe(approved)
    expect(senderRecord).not.toHaveProperty('approved')
  })
})

describe('handoff directory state machine paths', () => {
  it('shouldExposeTypedDirectoryStateMachineNames', () => {
    expect(HANDOFF_PATHS).toEqual({
      ownerOutboxTmp: 'outbox/tmp',
      ownerOutboxSent: 'outbox/sent',
      ownerOutboxFailed: 'outbox/failed',
      inboxNew: 'inbox/new',
      inboxInProcess: 'inbox/in_process',
      inboxCompleted: 'inbox/completed',
      pendingApproval: 'pending_approval',
      projectOutbox: 'outbox',
    })
  })
})
