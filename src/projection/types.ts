import type { Clarification, PendingApproval } from '../service/index.js'

export interface ProjectedTask {
  readonly name: string
  readonly lane: string
  readonly updatedAt: string
}

export interface ProjectedBoxes {
  readonly role: string
  readonly inbox: { readonly new: number; readonly inProcess: number; readonly completed: number }
  readonly outbox: { readonly tmp: number; readonly sent: number; readonly failed: number }
  readonly pendingInbox: string[]
  readonly pendingOutbox: string[]
}

/** Whole-value snapshot of the SwarmForge Attention (approvals) and Clarify queues. */
export interface SwarmQueueSnapshot {
  readonly approvals: PendingApproval[]
  readonly clarifications: Clarification[]
  readonly tasks: ProjectedTask[]
  readonly boxes: ProjectedBoxes[]
  readonly version: 2
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    swarm: SwarmQueueSnapshot | null
  }
  interface SessionProjectionMap {
    swarm: SwarmQueueSnapshot | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'swarm/queue': SwarmQueueSnapshot
  }
}
