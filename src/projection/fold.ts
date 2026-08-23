import type { SessionEvent } from '@deepseek-ai/dsh-session'

import type { SwarmQueueSnapshot } from './types.js'

export function applySwarmProjection(state: SwarmQueueSnapshot | null, event: SessionEvent): SwarmQueueSnapshot | null {
  if (event.type !== 'swarm/queue') return state
  return event.data
}
