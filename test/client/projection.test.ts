import { describe, expect, it } from 'vitest'

import { resolveSwarmProjection } from '../../src/client/projection.js'
import type { SwarmQueueSnapshot } from '../../src/projection/types.js'

import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

function sessionList(byId: Record<string, { readonly projectionValues?: { readonly swarm?: SwarmQueueSnapshot | null } }>): Pick<SessionListState, 'ids' | 'byId'> {
  return { ids: Object.keys(byId) as never, byId: byId as never }
}

const snapshot: SwarmQueueSnapshot = { approvals: [], clarifications: [], tasks: [], boxes: [], version: 2 }

describe('resolveSwarmProjection', () => {
  it('shouldPreferTheCurrentSessionsOwnNonNullProjection', () => {
    const sessions = sessionList({ other: { projectionValues: { swarm: snapshot } } })

    expect(resolveSwarmProjection(snapshot, sessions)).toBe(snapshot)
  })

  it('shouldFallBackToTheFirstOtherSessionCarryingANonNullSwarmProjectionWhenCurrentIsNull', () => {
    const sessions = sessionList({
      unrelated: { projectionValues: { swarm: null } },
      root: { projectionValues: { swarm: snapshot } },
    })

    expect(resolveSwarmProjection(null, sessions)).toBe(snapshot)
  })

  it('shouldFallBackWhenCurrentIsUndefinedBecauseTheCapabilityIsAbsentOnThisSession', () => {
    const sessions = sessionList({ root: { projectionValues: { swarm: snapshot } } })

    expect(resolveSwarmProjection(undefined, sessions)).toBe(snapshot)
  })

  it('shouldReturnUndefinedWhenNoSessionCarriesASwarmProjection', () => {
    const sessions = sessionList({ a: {}, b: { projectionValues: {} }, c: { projectionValues: { swarm: null } } })

    expect(resolveSwarmProjection(null, sessions)).toBeUndefined()
  })

  it('shouldReturnUndefinedForAnEmptySessionList', () => {
    expect(resolveSwarmProjection(undefined, sessionList({}))).toBeUndefined()
  })
})
