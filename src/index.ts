import { resolve } from 'node:path'

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import Schema from '@deepseek-ai/schemastery'

import { registerSwarmForgeCommand } from './commands.js'
import {
  changedFiles,
  commitReachableFromHead,
  mergeInto,
  validateCommit,
  worktreeHead,
} from './git/operations.js'
import { registerSwarmProjection } from './projection/register.js'
import {
  SwarmForgeService,
  type Clarification,
  type BoardTask,
  type InboxSummary,
  type OutboxSummary,
  type PendingApproval,
  type ReadyResult,
  type SendResult,
} from './service/index.js'
import { RoleSpawner, type SubagentClient } from './spawn/spawner.js'
import { registerSwarmForgeTools, type SwarmForgeToolRuntime } from './tools.js'

import type {} from '@deepseek-ai/dsh-tools'

export const name = 'swarmforge'
export const inject = ['tools', 'subagents', 'agents'] as const

export interface Config {
  readonly projectRoot?: string
  readonly confPath?: string
}

export const Config = Schema.object({
  projectRoot: Schema.string(),
  confPath: Schema.string(),
})

export interface ResolvedConfig {
  readonly projectRoot: string
  readonly confPath?: string
}

export class SwarmForgeRuntime extends Service implements SwarmForgeToolRuntime {
  readonly config: ResolvedConfig
  private readonly spawner: RoleSpawner<Agent>
  private service: SwarmForgeService | undefined
  private coordinator: Agent | undefined
  private serviceRoles: string[] = []
  private masterRoleName: string | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'swarmforge')
    this.config = {
      projectRoot: resolve(config.projectRoot ?? process.cwd()),
      ...(config.confPath === undefined ? {} : { confPath: config.confPath }),
    }
    this.spawner = new RoleSpawner<Agent>(subagentAdapter(ctx.subagents), agentAdapter(ctx.agents), {
      ...(config.confPath === undefined ? {} : { confPath: config.confPath }),
      composeFrom: (anchorCtx, coordinatorCtx) => {
        if (isContext(anchorCtx) && isContext(coordinatorCtx)) anchorCtx.get('agentPresets')?.composeFrom(anchorCtx, coordinatorCtx)
      },
    })
  }

  async start(agent: Agent, signal: AbortSignal): Promise<{ readonly roles: string[] }> {
    const started = await this.spawner.swarmStart(this.config.projectRoot, agent, signal)
    this.coordinator = agent
    this.service = new SwarmForgeService({
      projectRoot: this.config.projectRoot,
      roster: started.roster,
      gitOps: { worktreeHead, validateCommit, commitReachableFromHead, changedFiles, mergeInto },
      wake: (role, text) => this.spawner.wake(role, text),
      now: () => new Date(),
    })
    this.serviceRoles = started.roster.roles.map(({ name }) => name)
    this.masterRoleName = started.roster.roles.find(({ worktree }) => worktree === 'master')?.name
    await this.emitQueueSnapshot()
    return { roles: started.roster.roles.map(({ name }) => name) }
  }

  async sendHandoff(senderRole: string, draft: Readonly<Record<string, unknown>>): Promise<SendResult> {
    const result = await this.requireService().sendHandoff(senderRole, draft)
    await this.emitQueueSnapshot()
    return result
  }

  async readyForNext(role: string): Promise<ReadyResult> {
    const result = await this.requireService().readyForNext(role)
    await this.emitQueueSnapshot()
    return result
  }

  async doneWithCurrent(role: string): Promise<{ readonly file: string }> {
    const result = await this.requireService().doneWithCurrent(role)
    await this.emitQueueSnapshot()
    return result
  }

  async submitClarification(role: string, question: string): Promise<{ readonly clarificationId: string }> {
    const result = await this.requireService().submitClarification(role, question)
    await this.emitQueueSnapshot()
    return result
  }

  listPendingApprovals(): Promise<readonly PendingApproval[]> {
    return this.requireService().listPendingApprovals()
  }

  async approve(id: string): Promise<{ readonly id: string; readonly file: string }> {
    const result = await this.requireService().approve(id)
    await this.emitQueueSnapshot()
    return result
  }

  async reject(id: string): Promise<{ readonly id: string }> {
    const result = await this.requireService().reject(id)
    await this.emitQueueSnapshot()
    return result
  }

  listClarifications(): Promise<readonly Clarification[]> {
    return this.requireService().listClarifications()
  }

  async answerClarification(id: string, answer: string): Promise<{ readonly clarificationId: string }> {
    const result = await this.requireService().answerClarification(id, answer)
    await this.emitQueueSnapshot()
    return result
  }

  async createTask(name: string, lane: string, text: string): Promise<BoardTask> {
    const result = await this.requireService().createTask(name, lane, text)
    await this.emitQueueSnapshot()
    return result
  }

  masterRole(): string {
    if (this.masterRoleName === undefined) throw new Error('Call swarm_start before using SwarmForge commands.')
    return this.masterRoleName
  }

  listTasks(): Promise<readonly BoardTask[]> { return this.requireService().listTasks() }
  getTaskBody(name: string): Promise<string> { return this.requireService().getTaskBody(name) }
  getInboxSummary(role: string): Promise<InboxSummary> { return this.requireService().getInboxSummary(role) }
  getOutboxSummary(role: string): Promise<OutboxSummary> { return this.requireService().getOutboxSummary(role) }

  async moveTask(name: string, lane: string): Promise<BoardTask> {
    const result = await this.requireService().moveTask(name, lane)
    await this.emitQueueSnapshot()
    return result
  }

  private requireService(): SwarmForgeService {
    if (this.service === undefined) throw new Error('Call swarm_start before using SwarmForge role tools.')
    return this.service
  }

  private async emitQueueSnapshot(): Promise<void> {
    if (this.coordinator === undefined) throw new Error('Call swarm_start before using SwarmForge role tools.')
    const service = this.requireService()
    const [approvals, clarifications, tasks] = await Promise.all([
      service.listPendingApprovals(),
      service.listClarifications(),
      service.listTasks(),
    ])
    const boxes = await Promise.all(this.serviceRoles.map(async (role) => {
      const [inbox, outbox] = await Promise.all([service.getInboxSummary(role), service.getOutboxSummary(role)])
      return { role, inbox: inbox.counts, outbox: outbox.counts, pendingInbox: inbox.pending, pendingOutbox: outbox.pending }
    }))
    this.coordinator.session.append('swarm/queue', {
      approvals: [...approvals],
      clarifications: [...clarifications],
      tasks: tasks.map(({ name, lane, updatedAt }) => ({ name, lane, updatedAt })),
      boxes,
      version: 2,
    })
  }
}

function agentAdapter(agents: AgentRegistry) {
  return {
    create: async (spec: import('./spawn/spawner.js').AgentClient<Agent> extends { create(value: infer S): unknown } ? S : never) => agents.create({ ...spec, sessionId: SessionId(spec.sessionId), meta: { ...spec.meta, parentSession: SessionId(spec.meta.parentSession) } }),
    resume: async (spec: import('./spawn/spawner.js').AgentClient<Agent> extends { resume(value: infer S): unknown } ? S : never) => agents.resume({ ...spec, resumeSessionId: SessionId(spec.resumeSessionId) }),
    get: (id: string) => typeof agents.get === 'function' ? agents.get(SessionId(id)) : undefined,
  }
}

function isContext(value: unknown): value is Context {
  return typeof value === 'object' && value !== null && 'get' in value
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    swarmforge: SwarmForgeRuntime
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const runtime = new SwarmForgeRuntime(ctx, config)
  registerSwarmForgeTools(ctx.tools, runtime)
  registerSwarmProjection(ctx)
  ctx.inject(['commands'], (commandCtx) => {
    registerSwarmForgeCommand(commandCtx.commands, runtime)
  })
  ctx.logger('swarmforge').info('loaded')
}

function subagentAdapter(subagents: SubagentRuntime): SubagentClient<Agent> {
  return {
    async startContinuable(spec) {
      return subagents.startContinuable({
        ...spec,
        childId: SessionId(spec.childId),
        request: spec.request,
      })
    },
    async followup(parent, childId, content, options) {
      return subagents.followup(parent, SessionId(childId), content, {
        ...options,
        source: { ...options.source, senderSessionId: SessionId(options.source.senderSessionId) },
      })
    },
  }
}

const plugin = { name, inject, Config, apply }

export default plugin
