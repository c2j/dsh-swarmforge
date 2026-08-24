import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'

import { applySwarmProjection } from './fold.js'
import { swarmQueueSnapshotSchema } from './schema.js'
import type {} from './types.js'

const STATE_VERSION = 2

export function registerSwarmProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'swarm',
      stateSchema: swarmQueueSnapshotSchema,
      init: () => null,
      apply: applySwarmProjection,
      wire: { viewSchema: swarmQueueSnapshotSchema, view: (state) => state },
      stateVersion: STATE_VERSION,
    })
  })
}
