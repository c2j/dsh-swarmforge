import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import plugin, { type Config } from '../src/index.js'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createGitFixture } from './git/helpers.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('swarmforge plugin', () => {
  it('shouldMountServiceRegisterToolsAndStartFromConfiguredProjectRoot', async () => {
    const fixture = await createGitFixture()
    const projectRoot = fixture.cwd
    roots.push(projectRoot)
    await fixture.commit('initial')
    await mkdir(join(projectRoot, 'swarmforge'), { recursive: true })
    await writeFile(join(projectRoot, 'swarmforge', 'swarmforge.conf'), 'role lead worktree=master\nrole coder worktree=none\n', 'utf8')

    const definitions: ToolDefinition[] = []
    const startContinuable = vi.fn(async (spec: { readonly childId?: string }) => ({ childId: spec.childId ?? 'child', messageId: 'message' }))
    const ctx = new Context()
    ctx.provide('tools', { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } })
    ctx.provide('subagents', { startContinuable, followup: vi.fn(async () => 'message') })
    ctx.provide('agents', {
      create: vi.fn(async (spec: { readonly sessionId: string }) => ({ agent: { id: spec.sessionId, ctx: {}, options: {}, session: { header: {} } } })),
      resume: vi.fn(),
    })

    await ctx.plugin(plugin, { projectRoot } satisfies Config)
    const append = vi.fn()
    const parent = { id: 'lead-session', session: { header: {}, append } } as unknown as Agent
    const result = await ctx.swarmforge.start(parent, new AbortController().signal)

    expect(definitions.map(({ name }) => name)).toEqual(['swarm_start', 'swarm_handoff', 'ready_for_next', 'done_with_current', 'swarm_clarify'])
    expect(result.roles).toEqual(['lead', 'coder'])
    expect(append).toHaveBeenCalledWith('swarm/queue', expect.objectContaining({
      approvals: [],
      clarifications: [],
      tasks: [],
      version: 2,
    }))
    expect(startContinuable).toHaveBeenCalledTimes(2)
    expect(ctx.swarmforge.config.projectRoot).toBe(projectRoot)
    await ctx.fiber.dispose()
  })

  it('shouldDefaultProjectRootToProcessCwd', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    ctx.provide('tools', { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } })
    ctx.provide('subagents', { startContinuable: vi.fn(), followup: vi.fn() })
    ctx.provide('agents', { create: vi.fn(), resume: vi.fn() })

    await ctx.plugin(plugin, {})

    expect(ctx.swarmforge.config.projectRoot).toBe(process.cwd())
    await ctx.fiber.dispose()
  })

  it('shouldAppendASwarmQueueSnapshotEventToTheCoordinatorSessionWhenClarificationStateChanges', async () => {
    const fixture = await createGitFixture()
    const projectRoot = fixture.cwd
    roots.push(projectRoot)
    await fixture.commit('initial')
    await mkdir(join(projectRoot, 'swarmforge'), { recursive: true })
    await writeFile(join(projectRoot, 'swarmforge', 'swarmforge.conf'), 'role lead worktree=master\nrole coder worktree=none\n', 'utf8')

    const ctx = new Context()
    ctx.provide('tools', { register: () => () => undefined })
    ctx.provide('subagents', { startContinuable: vi.fn(async (spec: { readonly childId?: string }) => ({ childId: spec.childId ?? 'child', messageId: 'message' })), followup: vi.fn(async () => 'message') })
    ctx.provide('agents', {
      create: vi.fn(async (spec: { readonly sessionId: string }) => ({ agent: { id: spec.sessionId, ctx: {}, options: {}, session: { header: {} } } })),
      resume: vi.fn(),
    })

    await ctx.plugin(plugin, { projectRoot } satisfies Config)
    const append = vi.fn()
    const parent = { id: 'lead-session', session: { header: {}, append } } as unknown as Agent
    await ctx.swarmforge.start(parent, new AbortController().signal)

    await ctx.swarmforge.submitClarification('coder', 'Which parser API?')

    expect(append).toHaveBeenCalledWith('swarm/queue', {
      approvals: [],
      clarifications: [{ id: expect.any(String), role: 'coder', question: 'Which parser API?', file: expect.any(String) }],
      tasks: [],
      boxes: [
        { role: 'lead', inbox: { new: 0, inProcess: 0, completed: 0 }, outbox: { tmp: 0, sent: 0, failed: 0 }, pendingInbox: [], pendingOutbox: [] },
        { role: 'coder', inbox: { new: 0, inProcess: 0, completed: 0 }, outbox: { tmp: 0, sent: 0, failed: 0 }, pendingInbox: [], pendingOutbox: [] },
      ],
      version: 2,
    })
    await ctx.fiber.dispose()
  })

  it('shouldRegisterASwarmCommandOnceTheCommandsServiceIsAvailable', async () => {
    const ctx = new Context()
    ctx.provide('tools', { register: () => () => undefined })
    ctx.provide('subagents', { startContinuable: vi.fn(), followup: vi.fn() })
    ctx.provide('agents', { create: vi.fn(), resume: vi.fn() })
    const registered: string[] = []
    ctx.provide('commands', { register: (definition: { readonly name: string }) => { registered.push(definition.name); return () => undefined } })

    await ctx.plugin(plugin, {})

    expect(registered).toEqual(['swarm'])
    await ctx.fiber.dispose()
  })
})
