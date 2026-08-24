import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

import type { SwarmQueueSnapshot } from '../projection/types.js'

export function resolveSwarmProjection(
  current: SwarmQueueSnapshot | null | undefined,
  sessions: Pick<SessionListState, 'ids' | 'byId'>,
): SwarmQueueSnapshot | undefined {
  if (current !== undefined && current !== null) return current
  for (const id of sessions.ids) {
    const candidate = sessions.byId[id]?.projectionValues?.swarm
    if (candidate !== undefined && candidate !== null) return candidate
  }
  return undefined
}
