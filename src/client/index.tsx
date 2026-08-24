import { answerCommandLine, approveCommandLine, moveTaskCommandLine, newTaskCommandLine, rejectCommandLine } from './commands.js'
import { SwarmTab, type SwarmTabInjected } from './SwarmTab.tsx'

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-commands/remote'

export const inject = ['slots', 'remote', 'remote.commands']

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'swarm',
    order: 20,
    label: 'Swarm',
    inject: (sessionId: SessionId): SwarmTabInjected => ({
      approve: (id) => runSwarmCommand(ctx, sessionId, approveCommandLine(id)),
      reject: (id) => runSwarmCommand(ctx, sessionId, rejectCommandLine(id)),
      answer: (id, text) => runSwarmCommand(ctx, sessionId, answerCommandLine(id, text)),
      createTask: (name, text) => runSwarmCommand(ctx, sessionId, newTaskCommandLine(name, text)),
      moveTask: (name, lane) => runSwarmCommand(ctx, sessionId, moveTaskCommandLine(name, lane)),
      taskBody: (name) => runSwarmCommandForText(ctx, sessionId, `/swarm task ${name}`),
    }),
  }, SwarmTab))
}

async function runSwarmCommandForText(ctx: Context, sessionId: SessionId, line: string): Promise<{ readonly error: string | null; readonly text: string | null }> {
  const result = await ctx.remote.commands.execute(sessionId, line, [])
  if (!result.ok) return { error: `${result.error.message} (${result.error.code})`, text: null }
  if (result.value === undefined) return { error: `Unknown command: ${line}`, text: null }
  if (result.value.result.kind === 'error') return { error: result.value.result.text, text: null }
  return { error: null, text: result.value.result.text ?? null }
}

async function runSwarmCommand(ctx: Context, sessionId: SessionId, line: string): Promise<string | null> {
  const result = await ctx.remote.commands.execute(sessionId, line, [])
  if (!result.ok) return `${result.error.message} (${result.error.code})`
  if (result.value === undefined) return `Unknown command: ${line}`
  if (result.value.result.kind === 'error') return result.value.result.text
  return null
}
