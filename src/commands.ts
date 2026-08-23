import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'

import { ServiceError, type BoardTask, type Clarification, type InboxSummary, type OutboxSummary, type PendingApproval } from './service/index.js'

export interface SwarmForgeCommandRuntime {
  listPendingApprovals(): Promise<readonly PendingApproval[]>
  approve(id: string): Promise<{ readonly id: string; readonly file: string }>
  reject(id: string): Promise<{ readonly id: string }>
  listClarifications(): Promise<readonly Clarification[]>
  answerClarification(id: string, answer: string): Promise<{ readonly clarificationId: string }>
  masterRole(): string
  createTask(name: string, lane: string, text: string): Promise<BoardTask>
  listTasks(): Promise<readonly BoardTask[]>
  getTaskBody(name: string): Promise<string>
  moveTask(name: string, lane: string): Promise<BoardTask>
  getInboxSummary(role: string): Promise<InboxSummary>
  getOutboxSummary(role: string): Promise<OutboxSummary>
}

export interface CommandRegistrar {
  register(definition: CommandDefinition): () => void
}

export type SwarmCommandResult =
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string }

const USAGE = 'Usage: /swarm new <name> <text...> | tasks | task <name> | move <name> <role> | inbox <role> | outbox <role> | approve <id> | reject <id> | answer <clarification-id> <text...> | status'

export async function executeSwarmCommand(runtime: SwarmForgeCommandRuntime, rawInput: string): Promise<SwarmCommandResult> {
  const input = rawInput.trim()
  if (input.length === 0) return renderStatus(runtime)

  const [word = '', ...rest] = input.split(/\s+/u)
  switch (word) {
    case 'status':
      return renderStatus(runtime)
    case 'approve':
      return withId(rest, (id) => runtime.approve(id).then((result) => ({ kind: 'success', text: `Approved ${result.id} (${result.file}).` })))
    case 'reject':
      return withId(rest, (id) => runtime.reject(id).then((result) => ({ kind: 'success', text: `Rejected ${result.id}.` })))
    case 'answer':
      return answer(runtime, rest)
    case 'new':
      return createTask(runtime, rest)
    case 'tasks':
      return renderTasks(runtime)
    case 'task':
      return withId(rest, (name) => runtime.getTaskBody(name).then((text) => ({ kind: 'success', text })))
    case 'move':
      return moveTask(runtime, rest)
    case 'inbox':
      return withId(rest, async (role) => ({ kind: 'success', text: renderInbox(await runtime.getInboxSummary(role)) }))
    case 'outbox':
      return withId(rest, async (role) => ({ kind: 'success', text: renderOutbox(await runtime.getOutboxSummary(role)) }))
    default:
      return { kind: 'error', text: USAGE }
  }
}

export function registerSwarmForgeCommand(commands: CommandRegistrar, runtime: SwarmForgeCommandRuntime): () => void {
  return commands.register({
    name: 'swarm',
    description: 'Manage SwarmForge board, boxes, approvals, and clarifications.',
    input: { hint: '[new|tasks|task|move|inbox|outbox|approve|reject|answer|status] ...' },
    handler: (invocation: CommandInvocation) => executeSwarmCommand(runtime, invocation.rawInput),
  })
}

async function createTask(runtime: SwarmForgeCommandRuntime, rest: readonly string[]): Promise<SwarmCommandResult> {
  const [name, ...textWords] = rest
  const text = textWords.join(' ')
  if (name === undefined || text.length === 0) return { kind: 'error', text: USAGE }
  return runCatchingServiceError(async () => {
    const task = await runtime.createTask(name, runtime.masterRole(), text)
    return { kind: 'success', text: `Created ${task.name} in ${task.lane}.` }
  })
}

async function renderTasks(runtime: SwarmForgeCommandRuntime): Promise<SwarmCommandResult> {
  const tasks = await runtime.listTasks()
  return { kind: 'success', text: tasks.length === 0 ? 'No board tasks.' : tasks.map((task) => `- ${task.name} [${task.lane}] updated ${task.updatedAt}`).join('\n') }
}

async function moveTask(runtime: SwarmForgeCommandRuntime, rest: readonly string[]): Promise<SwarmCommandResult> {
  const [name, lane] = rest
  if (name === undefined || lane === undefined) return { kind: 'error', text: USAGE }
  return runCatchingServiceError(async () => {
    const task = await runtime.moveTask(name, lane)
    return { kind: 'success', text: `Moved ${task.name} to ${task.lane}.` }
  })
}

function renderInbox(summary: InboxSummary): string {
  const header = `${summary.role} inbox: new ${summary.counts.new}, in_process ${summary.counts.inProcess}, completed ${summary.counts.completed}`
  return summary.pending.length === 0 ? `${header}\nNo pending files.` : `${header}\n${summary.pending.map((file) => `- ${file}`).join('\n')}`
}

function renderOutbox(summary: OutboxSummary): string {
  const header = `${summary.role} outbox: tmp ${summary.counts.tmp}, sent ${summary.counts.sent}, failed ${summary.counts.failed}`
  return summary.pending.length === 0 ? `${header}\nNo pending files.` : `${header}\n${summary.pending.map((file) => `- ${file}`).join('\n')}`
}

async function withId(rest: readonly string[], operation: (id: string) => Promise<SwarmCommandResult>): Promise<SwarmCommandResult> {
  const id = rest[0]
  if (id === undefined || id.length === 0) return { kind: 'error', text: USAGE }
  return runCatchingServiceError(() => operation(id))
}

async function answer(runtime: SwarmForgeCommandRuntime, rest: readonly string[]): Promise<SwarmCommandResult> {
  const [id, ...answerWords] = rest
  const text = answerWords.join(' ')
  if (id === undefined || id.length === 0 || text.length === 0) return { kind: 'error', text: USAGE }
  return runCatchingServiceError(async () => {
    const result = await runtime.answerClarification(id, text)
    return { kind: 'success', text: `Answered ${result.clarificationId}.` }
  })
}

async function runCatchingServiceError(operation: () => Promise<SwarmCommandResult>): Promise<SwarmCommandResult> {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof ServiceError) return { kind: 'error', text: error.message }
    throw error
  }
}

async function renderStatus(runtime: SwarmForgeCommandRuntime): Promise<SwarmCommandResult> {
  const [approvals, clarifications] = await Promise.all([runtime.listPendingApprovals(), runtime.listClarifications()])
  const approvalLines = approvals.length === 0
    ? 'No pending approvals.'
    : approvals.map((approval) => `- ${approval.id} ${approval.task} (${approval.from} -> ${approval.to})`).join('\n')
  const clarificationLines = clarifications.length === 0
    ? 'No open clarifications.'
    : clarifications.map((clarification) => `- ${clarification.id} [${clarification.role}] ${clarification.question}`).join('\n')
  return { kind: 'success', text: `Attention:\n${approvalLines}\n\nClarify:\n${clarificationLines}` }
}
