import { describe, expect, it, vi } from 'vitest'

import {
  createToolHandlers,
  registerSwarmForgeTools,
  type SwarmForgeToolRuntime,
  type ToolRegistrar,
} from '../src/tools.js'

function setup() {
  const runtime: SwarmForgeToolRuntime = {
    start: vi.fn(async () => ({ roles: ['specifier', 'coder'] })),
    sendHandoff: vi.fn(async () => ({ id: 'handoff-id', file: 'handoff-file' })),
    readyForNext: vi.fn(async () => ({ status: 'NO_TASK' as const })),
    doneWithCurrent: vi.fn(async () => ({ file: 'completed-file' })),
    submitClarification: vi.fn(async () => ({ clarificationId: 'clar-id' })),
  }
  return { runtime, handlers: createToolHandlers(runtime) }
}

describe('createToolHandlers', () => {
  it('shouldMapSwarmStartToTheCallingAgent', async () => {
    const { runtime, handlers } = setup()
    const signal = new AbortController().signal
    const caller = { id: 'lead-session' }

    await expect(handlers.swarmStart(caller, signal)).resolves.toEqual({ roles: ['specifier', 'coder'] })
    expect(runtime.start).toHaveBeenCalledWith(caller, signal)
  })

  it('shouldForwardAllDraftFieldsAndInferSenderFromSessionId', async () => {
    const { runtime, handlers } = setup()
    const draft = { type: 'git_handoff', to: 'coder', priority: '07', task: 'Build parser', commit: 'abcdef1234' }

    await handlers.swarmHandoff({ id: 'specifier' }, draft)

    expect(runtime.sendHandoff).toHaveBeenCalledWith('specifier', draft)
  })

  it('shouldReturnStructuredNoTaskAndCompleteForCallingRole', async () => {
    const { runtime, handlers } = setup()

    await expect(handlers.readyForNext({ id: 'coder' })).resolves.toEqual({ status: 'NO_TASK' })
    await expect(handlers.doneWithCurrent({ id: 'coder' })).resolves.toEqual({ file: 'completed-file' })
    expect(runtime.readyForNext).toHaveBeenCalledWith('coder')
    expect(runtime.doneWithCurrent).toHaveBeenCalledWith('coder')
  })

  it('shouldRejectCallsWithoutAnAgentIdentity', async () => {
    const { handlers } = setup()

    await expect(handlers.readyForNext(undefined)).rejects.toThrow('requires an active agent session')
  })

  it('shouldMapSwarmClarifyToCallingRole', async () => {
    const { runtime, handlers } = setup()

    await expect(handlers.swarmClarify({ id: 'coder' }, 'Which parser API?')).resolves.toEqual({ clarificationId: 'clar-id' })
    expect(runtime.submitClarification).toHaveBeenCalledWith('coder', 'Which parser API?')
  })
})

describe('registerSwarmForgeTools', () => {
  it('shouldRegisterSwarmClarifyAndBatchReadyOutputSchemas', () => {
    const { runtime } = setup()
    const definitions: Array<{ readonly name: string; readonly output: { readonly schema: unknown } }> = []
    const tools: ToolRegistrar = { register: (definition) => { definitions.push(definition); return () => undefined } }

    registerSwarmForgeTools(tools, runtime)

    expect(definitions.map(({ name }) => name)).toEqual([
      'swarm_start', 'swarm_handoff', 'ready_for_next', 'done_with_current', 'swarm_clarify',
    ])
    expect(definitions.every(({ output }) => output.schema !== undefined)).toBe(true)
    expect(definitions.find(({ name }) => name === 'ready_for_next')?.output.schema).toMatchObject({
      oneOf: expect.arrayContaining([expect.objectContaining({
        properties: expect.objectContaining({ status: { type: 'string', const: 'BATCH' } }),
        required: expect.arrayContaining(['status', 'items']),
      })]),
    })
  })
})
