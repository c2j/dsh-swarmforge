import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  RoleSpawner,
  anchorIdFor,
  type AgentClient,
  type ParentAgent,
  type SubagentClient,
} from '../../src/spawn/spawner.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

interface TestAgent extends ParentAgent {
  readonly ctx: { readonly name: string }
  readonly options: { readonly provider?: string; readonly model?: string }
  readonly session: { readonly header: { readonly delegationDepth?: number } }
}

async function setup() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'swarmforge-spawner-'))
  roots.push(projectRoot)
  await mkdir(join(projectRoot, 'swarmforge'), { recursive: true })
  await writeFile(join(projectRoot, 'swarmforge', 'swarmforge.conf'), [
    'role specifier worktree=master provider=anthropic model=claude-opus',
    'role coder worktree=coder model=deepseek-chat',
  ].join('\n'), 'utf8')
  const subagents: SubagentClient<TestAgent> = {
    startContinuable: vi.fn(async (spec) => ({ childId: spec.childId, messageId: 'message-id' })),
    followup: vi.fn(async () => 'message-id'),
  }
  const agentFor = (id: string): TestAgent => ({
    id,
    ctx: { name: id },
    options: { provider: 'coordinator-provider', model: 'coordinator-model' },
    session: { header: { delegationDepth: 2 } },
  })
  const agents: AgentClient<TestAgent> = {
    create: vi.fn(async (spec) => ({ agent: agentFor(spec.sessionId) })),
    resume: vi.fn(async (spec) => ({ agent: agentFor(spec.resumeSessionId) })),
  }
  const parent = agentFor('lead-session')
  return { projectRoot, subagents, agents, parent }
}

describe('RoleSpawner', () => {
  it('shouldCreateWorktreeAnchorsThenStartStableRoleChildrenWithPerRoleModels', async () => {
    const { projectRoot, subagents, agents, parent } = await setup()
    const ensureWorktree = vi.fn(async (_root: string, name: string) => ({ path: join(projectRoot, '.worktrees', name), created: true }))
    const composeFrom = vi.fn()
    const spawner = new RoleSpawner(subagents, agents, {
      ensureWorktree,
      composeFrom,
      ensureRuntimeExcludes: vi.fn(async () => undefined),
      installCommitMsgHook: vi.fn(async () => undefined),
    })

    const result = await spawner.swarmStart(projectRoot, parent, new AbortController().signal)

    expect(result.roster.roles.map(({ name, cwd }) => ({ name, cwd }))).toEqual([
      { name: 'specifier', cwd: projectRoot },
      { name: 'coder', cwd: join(projectRoot, '.worktrees', 'coder') },
    ])
    expect(ensureWorktree).toHaveBeenCalledOnce()
    expect(agents.create).toHaveBeenCalledTimes(2)
    expect(vi.mocked(agents.create).mock.calls[1]?.[0]).toMatchObject({
      sessionId: anchorIdFor(parent.id, 'coder'),
      meta: { cwd: join(projectRoot, '.worktrees', 'coder'), parentSession: parent.id, origin: 'subagent', delegationDepth: 3 },
      agentOptions: parent.options,
    })
    const anchorSetup = vi.mocked(agents.create).mock.calls[1]?.[0].setup
    anchorSetup?.({ name: 'anchor-context' })
    expect(composeFrom).toHaveBeenCalledWith({ name: 'anchor-context' }, parent.ctx)
    expect(vi.mocked(subagents.startContinuable).mock.calls[0]?.[0]).toMatchObject({
      provider: 'spawn', childId: 'specifier', label: 'SwarmForge role: specifier',
      request: { parent: expect.objectContaining({ id: anchorIdFor(parent.id, 'specifier') }), agentOptions: { provider: 'anthropic', model: 'claude-opus' } },
    })
    expect(vi.mocked(subagents.startContinuable).mock.calls[1]?.[0]).toMatchObject({
      request: { parent: expect.objectContaining({ id: anchorIdFor(parent.id, 'coder') }), agentOptions: { model: 'deepseek-chat' } },
    })
    expect(await readFile(join(projectRoot, '.swarmforge', 'anchors.tsv'), 'utf8')).toContain(`coder\t${anchorIdFor(parent.id, 'coder')}`)
  })

  it('shouldResumePersistedAnchorsBeforeStartingChildren', async () => {
    const { projectRoot, subagents, agents, parent } = await setup()
    await mkdir(join(projectRoot, '.swarmforge'), { recursive: true })
    await writeFile(join(projectRoot, '.swarmforge', 'anchors.tsv'), [
      'role\tanchor-session',
      `specifier\t${anchorIdFor(parent.id, 'specifier')}`,
      `coder\t${anchorIdFor(parent.id, 'coder')}`,
      '',
    ].join('\n'), 'utf8')
    const spawner = new RoleSpawner(subagents, agents, {
      ensureWorktree: vi.fn(async (_root, name) => ({ path: join(projectRoot, '.worktrees', name), created: false })),
      ensureRuntimeExcludes: vi.fn(async () => undefined),
      installCommitMsgHook: vi.fn(async () => undefined),
    })

    await spawner.swarmStart(projectRoot, parent, new AbortController().signal)

    expect(agents.create).not.toHaveBeenCalled()
    expect(agents.resume).toHaveBeenCalledTimes(2)
    expect(vi.mocked(agents.resume).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(subagents.startContinuable).mock.invocationCallOrder[0] ?? Infinity)
  })

  it('shouldWakeRoleThroughItsLiveAnchorWithVerbatimText', async () => {
    const { projectRoot, subagents, agents, parent } = await setup()
    const spawner = new RoleSpawner(subagents, agents, {
      ensureWorktree: vi.fn(async (_root, name) => ({ path: join(projectRoot, '.worktrees', name), created: false })),
      ensureRuntimeExcludes: vi.fn(async () => undefined),
      installCommitMsgHook: vi.fn(async () => undefined),
    })
    await spawner.swarmStart(projectRoot, parent, new AbortController().signal)

    await spawner.wake('coder', 'You have new handoff mail. If idle, run ready_for_next.')

    expect(subagents.followup).toHaveBeenCalledWith(
      expect.objectContaining({ id: anchorIdFor(parent.id, 'coder') }),
      'coder',
      [{ type: 'text', text: 'You have new handoff mail. If idle, run ready_for_next.' }],
      {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: expect.any(AbortSignal),
      },
    )
  })
})
