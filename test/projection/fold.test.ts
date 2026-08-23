import { describe, expect, it } from 'vitest'

import { applySwarmProjection } from '../../src/projection/fold.js'
import type { SwarmQueueSnapshot } from '../../src/projection/types.js'

import type { SessionEvent } from '@deepseek-ai/dsh-session'

function queueEvent(seq: number, data: SwarmQueueSnapshot): SessionEvent {
  return { type: 'swarm/queue', seq, time: 0, data } as SessionEvent
}

function otherEvent(seq: number): SessionEvent {
  return { type: 'todo/write', seq, time: 0, data: { todos: [] } } as SessionEvent
}

describe('applySwarmProjection', () => {
  it('shouldStartAtNullBeforeAnySwarmQueueEvent', () => {
    expect(applySwarmProjection(null, otherEvent(0))).toBeNull()
  })

  it('shouldReturnTheSameReferenceForUnrelatedEvents', () => {
    const state: SwarmQueueSnapshot = { approvals: [], clarifications: [], tasks: [], boxes: [], version: 2 }

    expect(applySwarmProjection(state, otherEvent(1))).toBe(state)
  })

  it('shouldReplaceWholeStateOnASwarmQueueEvent', () => {
    const next: SwarmQueueSnapshot = {
      approvals: [{ id: 'a1', task: 'Build parser', from: 'specifier', to: 'coder', artifacts: 'a.ts', file: 'a1.handoff' }],
      clarifications: [],
      tasks: [{ name: 'build-parser', lane: 'specifier', updatedAt: '2026-08-24T10:00:00.000Z' }],
      boxes: [{ role: 'specifier', inbox: { new: 0, inProcess: 0, completed: 1 }, outbox: { tmp: 0, sent: 1, failed: 0 }, pendingInbox: [], pendingOutbox: [] }],
      version: 2,
    }

    expect(applySwarmProjection(null, queueEvent(1, next))).toEqual(next)
  })

  it('shouldLetALaterSwarmQueueEventWinOverAnOlderOne', () => {
    const first: SwarmQueueSnapshot = { approvals: [], clarifications: [], tasks: [], boxes: [], version: 2 }
    const second: SwarmQueueSnapshot = {
      approvals: [],
      clarifications: [{ id: 'clar-1', role: 'coder', question: 'Which API?', file: 'clar-1.request' }],
      tasks: [],
      boxes: [],
      version: 2,
    }
    const afterFirst = applySwarmProjection(null, queueEvent(1, first))

    expect(applySwarmProjection(afterFirst, queueEvent(2, second))).toEqual(second)
  })
})
