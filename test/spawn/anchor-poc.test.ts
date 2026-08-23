import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

class ModelFreeAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '' } }
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('Route A′ anchor proof of concept', () => {
  it('shouldPropagateAnchorCwdAndLineageToAContinuableRoleChildAndJoinPresetComposition', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'swarmforge-anchor-sessions-'))
    const worktree = await mkdtemp(join(tmpdir(), 'swarmforge-anchor-worktree-'))
    roots.push(persistenceRoot, worktree)
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot })
    await ctx.plugin(AgentLoop, { agents: [] })
    const composeFrom = vi.fn((_agentCtx: Context, _parentCtx: Context) => 'test-preset')
    ctx.provide('agentPresets', { composeFrom, composedPreset: (_agentCtx: Context) => 'test-preset' })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    ctx.llm.registerAdapter(['mock'], new ModelFreeAdapter())

    const coordinator = await ctx.agents.create({
      sessionId: SessionId('coordinator'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const anchor = await ctx.agents.create({
      sessionId: SessionId('swarmforge-anchor-coordinator-coder'),
      meta: {
        cwd: worktree,
        parentSession: coordinator.agent.id,
        origin: 'subagent',
        delegationDepth: 1,
      },
      agentOptions: { ...coordinator.agent.options },
      setup: (anchorCtx) => { anchorCtx.get('agentPresets')?.composeFrom(anchorCtx, coordinator.agent.ctx) },
    })

    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'coder',
      childId: SessionId('coder'),
      request: {
        parent: anchor.agent,
        prompt: [{ type: 'text', text: 'model-free anchor PoC' }],
      },
      signal: new AbortController().signal,
    })
    const child = ctx.agents.get(started.childId)

    expect(anchor.agent.session.header).toMatchObject({
      cwd: worktree,
      parentSession: coordinator.agent.id,
      origin: 'subagent',
      delegationDepth: 1,
    })
    expect(child?.session.header.cwd).toBe(worktree)
    expect(child?.session.header.parentSession).toBe(anchor.agent.id)
    expect(composeFrom).toHaveBeenCalledWith(anchor.agent.ctx, coordinator.agent.ctx)
    expect(composeFrom).toHaveBeenCalledWith(child?.ctx, anchor.agent.ctx)
  }, 20_000)
})
