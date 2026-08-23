import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { ensureRuntimeExcludes } from '../git/operations.js'
import { installCommitMsgHook } from '../git/byline.js'
import { ensureWorktree } from '../git/worktrees.js'
import { ensureRuntimeState, parseRoster, readAnchorIds, writeAnchorIds, type Roster } from '../service/index.js'
import { buildSeedPrompt } from './prompt.js'

export interface ParentAgent {
  readonly id: string
  readonly ctx?: unknown
  readonly options?: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number }
  readonly session?: { readonly header: { readonly delegationDepth?: number } }
}

interface StartSpec<A extends ParentAgent> {
  readonly provider: string
  readonly label: string
  readonly childId: string
  readonly request: {
    readonly prompt: Array<{ readonly type: 'text'; readonly text: string }>
    readonly parent: A
    readonly agentOptions?: { readonly provider?: string; readonly model?: string }
  }
  readonly signal: AbortSignal
}

export interface SubagentClient<A extends ParentAgent = ParentAgent> {
  startContinuable(spec: StartSpec<A>): Promise<{ readonly childId: string; readonly messageId: string }>
  followup(parent: A, childId: string, content: Array<{ readonly type: 'text'; readonly text: string }>, options: {
    readonly source: { readonly kind: 'coordinator'; readonly form: 'relay'; readonly senderSessionId: string }
    readonly signal: AbortSignal
  }): Promise<string>
}

interface AnchorSpec {
  readonly sessionId: string
  readonly meta: { readonly cwd: string; readonly parentSession: string; readonly origin: 'subagent'; readonly delegationDepth: number }
  readonly agentOptions?: ParentAgent['options']
  readonly signal: AbortSignal
  readonly setup: (anchorCtx: unknown) => void
}

interface ResumeSpec {
  readonly resumeSessionId: string
  readonly agentOptions?: ParentAgent['options']
  readonly signal: AbortSignal
  readonly setup: (anchorCtx: unknown) => void
}

export interface AgentClient<A extends ParentAgent = ParentAgent> {
  create(spec: AnchorSpec): Promise<{ readonly agent: A; readonly dispose?: () => Promise<void> }>
  resume(spec: ResumeSpec): Promise<{ readonly agent: A; readonly dispose?: () => Promise<void> }>
}

export interface RoleSpawnerOptions {
  readonly confPath?: string
  readonly toolNames?: readonly string[]
  readonly ensureWorktree?: typeof ensureWorktree
  readonly ensureRuntimeExcludes?: (projectRoot: string) => Promise<unknown>
  readonly installCommitMsgHook?: (projectRoot: string) => Promise<unknown>
  readonly composeFrom?: (anchorCtx: unknown, coordinatorCtx: unknown) => unknown
}

export interface SwarmStartResult {
  readonly roster: Roster
  readonly children: readonly { readonly role: string; readonly childId: string; readonly messageId: string }[]
}

export function anchorIdFor(coordinatorId: string, role: string): string {
  return `swarmforge-anchor-${coordinatorId}-${role}`
}

export class RoleSpawner<A extends ParentAgent = ParentAgent> {
  private coordinator: A | undefined
  private readonly anchors = new Map<string, A>()
  private readonly anchorHandles = new Map<string, { readonly agent: A; readonly dispose?: () => Promise<void> }>()

  constructor(private readonly subagents: SubagentClient<A>, private readonly agents: AgentClient<A>, private readonly options: RoleSpawnerOptions = {}) {}

  async swarmStart(projectRoot: string, coordinator: A, signal: AbortSignal): Promise<SwarmStartResult> {
    const configuredPath = this.options.confPath ?? join('swarmforge', 'swarmforge.conf')
    const confPath = isAbsolute(configuredPath) ? configuredPath : join(projectRoot, configuredPath)
    const worktreePaths = new Map<string, string>()
    const createWorktree = this.options.ensureWorktree ?? ensureWorktree
    const content = await readFile(confPath, 'utf8')
    const roster = parseRoster(content, projectRoot)

    await (this.options.ensureRuntimeExcludes ?? ensureRuntimeExcludes)(projectRoot)
    for (const role of roster.roles) {
      if (role.worktree !== 'master' && role.worktree !== 'none') {
        const result = await createWorktree(projectRoot, role.worktree)
        worktreePaths.set(role.worktree, result.path)
      }
    }
    const resolvedRoster = parseRoster(content, projectRoot, (role, root) =>
      role.worktree === 'master' || role.worktree === 'none' ? root : worktreePaths.get(role.worktree) ?? root)
    await (this.options.installCommitMsgHook ?? installCommitMsgHook)(projectRoot)
    await ensureRuntimeState(projectRoot, resolvedRoster)

    this.coordinator = coordinator
    const persisted = await readAnchorIds(projectRoot)
    const anchorIds = new Map<string, string>()
    for (const role of resolvedRoster.roles) {
      const anchorId = persisted.get(role.name) ?? anchorIdFor(coordinator.id, role.name)
      const setup = (anchorCtx: unknown): void => {
        this.options.composeFrom?.(anchorCtx, coordinator.ctx)
      }
      const handle = persisted.has(role.name)
        ? await this.agents.resume({ resumeSessionId: anchorId, agentOptions: coordinator.options, signal, setup })
        : await this.agents.create({
          sessionId: anchorId,
          meta: {
            cwd: role.cwd,
            parentSession: coordinator.id,
            origin: 'subagent',
            delegationDepth: (coordinator.session?.header.delegationDepth ?? 0) + 1,
          },
          agentOptions: coordinator.options,
          signal,
          setup,
        })
      this.anchors.set(role.name, handle.agent)
      this.anchorHandles.set(role.name, handle)
      anchorIds.set(role.name, anchorId)
    }
    await writeAnchorIds(projectRoot, anchorIds)

    const tools = this.options.toolNames ?? ['swarm_handoff', 'ready_for_next', 'done_with_current']
    const children = await Promise.all(resolvedRoster.roles.map(async (role) => {
      const anchor = this.anchors.get(role.name)
      if (anchor === undefined) throw new Error(`Anchor for ${role.name} is unavailable.`)
      const agentOptions = { ...(role.provider === undefined ? {} : { provider: role.provider }), ...(role.model === undefined ? {} : { model: role.model }) }
      const started = await this.subagents.startContinuable({
        provider: 'spawn', childId: role.name, label: `SwarmForge role: ${role.name}`,
        request: { parent: anchor, prompt: [{ type: 'text', text: buildSeedPrompt(role.name, tools) }], ...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }) },
        signal,
      })
      return { role: role.name, ...started }
    }))
    return { roster: resolvedRoster, children }
  }

  async wake(role: string, text: string): Promise<void> {
    if (this.coordinator === undefined) throw new Error('SwarmForge has not been started.')
    const anchor = this.anchors.get(role)
    if (anchor === undefined) throw new Error(`Unknown SwarmForge role "${role}".`)
    await this.subagents.followup(anchor, role, [{ type: 'text', text }], {
      source: { kind: 'coordinator', form: 'relay', senderSessionId: this.coordinator.id },
      signal: new AbortController().signal,
    })
  }
}
