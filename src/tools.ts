import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { ReadyResult, SendResult } from './service/index.js'

export interface ToolAgent {
  readonly id: string
}

export interface SwarmForgeToolRuntime {
  start(agent: ToolAgent, signal: AbortSignal): Promise<{ readonly roles: string[] }>
  sendHandoff(senderRole: string, draft: Readonly<Record<string, unknown>>): Promise<SendResult>
  readyForNext(role: string): Promise<ReadyResult>
  doneWithCurrent(role: string): Promise<{ readonly file: string }>
  submitClarification(role: string, question: string): Promise<{ readonly clarificationId: string }>
}

export interface ToolRegistrar {
  register(definition: ToolDefinition): () => void
}

function requireAgent(agent: ToolAgent | undefined): ToolAgent {
  if (agent === undefined) throw new Error('SwarmForge tool requires an active agent session.')
  return agent
}

export function createToolHandlers(runtime: SwarmForgeToolRuntime) {
  return {
    swarmStart: async (agent: ToolAgent | undefined, signal: AbortSignal) => runtime.start(requireAgent(agent), signal),
    swarmHandoff: async (agent: ToolAgent | undefined, draft: Readonly<Record<string, unknown>>) =>
      runtime.sendHandoff(requireAgent(agent).id, draft),
    readyForNext: async (agent: ToolAgent | undefined) => runtime.readyForNext(requireAgent(agent).id),
    doneWithCurrent: async (agent: ToolAgent | undefined) => runtime.doneWithCurrent(requireAgent(agent).id),
    swarmClarify: async (agent: ToolAgent | undefined, question: string) => runtime.submitClarification(requireAgent(agent).id, question),
  }
}

const textOutput = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]

const taskProperties = {
  status: { type: 'string' as const, enum: ['TASK', 'RESUME'] as const, required: true },
  from: { type: 'string' as const, required: true },
  type: { type: 'string' as const, enum: ['git_handoff', 'note'] as const, required: true },
  priority: { type: 'string' as const, required: true },
  taskName: { type: 'string' as const },
  payload: { type: 'string' as const, required: true },
  file: { type: 'string' as const, required: true },
} as const

const batchItemProperties = {
  from: { type: 'string' as const, required: true },
  type: { type: 'string' as const, enum: ['git_handoff', 'note'] as const, required: true },
  taskName: { type: 'string' as const },
  payload: { type: 'string' as const, required: true },
} as const

export function registerSwarmForgeTools(tools: ToolRegistrar, runtime: SwarmForgeToolRuntime): void {
  const handlers = createToolHandlers(runtime)
  tools.register(defineTool({
    name: 'swarm_start',
    description: 'Start every configured SwarmForge role for this project.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { roles: { type: 'array', items: { type: 'string' }, required: true } },
      },
      render: (_args, value) => textOutput(value),
    },
    execute: (_args, exec) => handlers.swarmStart(exec.agent, exec.signal),
  }))

  tools.register(defineTool({
    name: 'swarm_handoff',
    description: 'Send a validated handoff or note from the current SwarmForge role.',
    parameters: {
      type: { type: 'string', enum: ['git_handoff', 'note'], required: true },
      to: { type: 'string', required: true },
      priority: { type: 'string' },
      task: { type: 'string' },
      commit: { type: 'string' },
      message: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          file: { type: 'string', required: true },
        },
      },
      render: (_args, value) => textOutput(value),
    },
    execute: (args, exec) => handlers.swarmHandoff(exec.agent, args),
  }))

  tools.register(defineTool({
    name: 'ready_for_next',
    description: 'Claim or resume the next queued handoff for the current SwarmForge role.',
    parameters: {},
    output: {
      schema: {
        oneOf: [
          {
            type: 'object', additionalProperties: false,
            properties: { status: { type: 'string', const: 'NO_TASK', required: true } },
          },
          { type: 'object', additionalProperties: false, properties: taskProperties },
          {
            type: 'object', additionalProperties: false,
            properties: {
              status: { type: 'string', const: 'BATCH', required: true },
              items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: batchItemProperties }, required: true },
            },
          },
        ],
      },
      render: (_args, value) => textOutput(value),
    },
    execute: (_args, exec) => handlers.readyForNext(exec.agent),
  }))

  tools.register(defineTool({
    name: 'done_with_current',
    description: 'Mark the current SwarmForge handoff complete for the current role.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { file: { type: 'string', required: true } },
      },
      render: (_args, value) => textOutput(value),
    },
    execute: (_args, exec) => handlers.doneWithCurrent(exec.agent),
  }))

  tools.register(defineTool({
    name: 'swarm_clarify',
    description: 'Submit a question for asynchronous human clarification.',
    parameters: { question: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { clarificationId: { type: 'string', required: true } },
      },
      render: (_args, value) => textOutput(value),
    },
    execute: (args, exec) => handlers.swarmClarify(exec.agent, args.question),
  }))
}
