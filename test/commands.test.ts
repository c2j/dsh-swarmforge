import { describe, expect, it, vi } from 'vitest'

import {
  executeSwarmCommand,
  registerSwarmForgeCommand,
  type CommandRegistrar,
  type SwarmForgeCommandRuntime,
} from '../src/commands.js'
import { ServiceError } from '../src/service/index.js'

import type { CommandDefinition } from '@deepseek-ai/dsh-commands'

function setup(): SwarmForgeCommandRuntime {
  return {
    masterRole: () => 'specifier',
    listPendingApprovals: vi.fn(async () => []),
    approve: vi.fn(async (id: string) => ({ id, file: `${id}.handoff` })),
    reject: vi.fn(async (id: string) => ({ id })),
    listClarifications: vi.fn(async () => []),
    answerClarification: vi.fn(async (id: string) => ({ clarificationId: id })),
    createTask: vi.fn(async (name: string, lane: string) => ({ name, lane, createdAt: 'now', updatedAt: 'now' })),
    listTasks: vi.fn(async () => []),
    getTaskBody: vi.fn(async () => 'task body'),
    moveTask: vi.fn(async (name: string, lane: string) => ({ name, lane, createdAt: 'then', updatedAt: 'now' })),
    getInboxSummary: vi.fn(async (role: string) => ({ role, counts: { new: 0, inProcess: 0, completed: 0 }, pending: [] })),
    getOutboxSummary: vi.fn(async (role: string) => ({ role, counts: { tmp: 0, sent: 0, failed: 0 }, pending: [] })),
  }
}

describe('executeSwarmCommand', () => {
  it('shouldReportEmptyQueuesOnStatusWithNoArguments', async () => {
    const runtime = setup()

    await expect(executeSwarmCommand(runtime, '')).resolves.toEqual({
      kind: 'success',
      text: 'Attention:\nNo pending approvals.\n\nClarify:\nNo open clarifications.',
    })
  })

  it('shouldReportEmptyQueuesOnExplicitStatus', async () => {
    const runtime = setup()

    await expect(executeSwarmCommand(runtime, 'status')).resolves.toMatchObject({ kind: 'success' })
  })

  it('shouldListPendingApprovalsAndClarificationsOnStatus', async () => {
    const runtime = setup()
    runtime.listPendingApprovals = vi.fn(async () => [
      { id: 'ho-1', task: 'Build parser', from: 'specifier', to: 'coder', artifacts: 'a.ts', file: 'ho-1.handoff' },
    ])
    runtime.listClarifications = vi.fn(async () => [
      { id: 'clar-1', role: 'coder', question: 'Which API?', file: 'clar-1.request' },
    ])

    const result = await executeSwarmCommand(runtime, 'status')

    expect(result).toEqual({
      kind: 'success',
      text: 'Attention:\n- ho-1 Build parser (specifier -> coder)\n\nClarify:\n- clar-1 [coder] Which API?',
    })
  })

  it('shouldApproveById', async () => {
    const runtime = setup()

    await expect(executeSwarmCommand(runtime, 'approve ho-1')).resolves.toEqual({
      kind: 'success',
      text: 'Approved ho-1 (ho-1.handoff).',
    })
    expect(runtime.approve).toHaveBeenCalledWith('ho-1')
  })

  it('shouldRejectApproveWithoutAnId', async () => {
    const runtime = setup()

    const result = await executeSwarmCommand(runtime, 'approve')

    expect(result.kind).toBe('error')
    expect(runtime.approve).not.toHaveBeenCalled()
  })

  it('shouldReportAServiceErrorAsAnErrorResultOnApprove', async () => {
    const runtime = setup()
    runtime.approve = vi.fn(async () => { throw new ServiceError('approval-not-found', 'Pending approval "ho-1" was not found.') })

    await expect(executeSwarmCommand(runtime, 'approve ho-1')).resolves.toEqual({
      kind: 'error',
      text: 'Pending approval "ho-1" was not found.',
    })
  })

  it('shouldRejectById', async () => {
    const runtime = setup()

    await expect(executeSwarmCommand(runtime, 'reject ho-1')).resolves.toEqual({ kind: 'success', text: 'Rejected ho-1.' })
    expect(runtime.reject).toHaveBeenCalledWith('ho-1')
  })

  it('shouldReportAServiceErrorAsAnErrorResultOnReject', async () => {
    const runtime = setup()
    runtime.reject = vi.fn(async () => { throw new ServiceError('approval-not-found', 'Pending approval "ho-9" was not found.') })

    await expect(executeSwarmCommand(runtime, 'reject ho-9')).resolves.toEqual({
      kind: 'error',
      text: 'Pending approval "ho-9" was not found.',
    })
  })

  it('shouldAnswerAClarificationWithAMultiWordText', async () => {
    const runtime = setup()

    await expect(executeSwarmCommand(runtime, 'answer clar-1 Use the v2 parser API')).resolves.toEqual({
      kind: 'success',
      text: 'Answered clar-1.',
    })
    expect(runtime.answerClarification).toHaveBeenCalledWith('clar-1', 'Use the v2 parser API')
  })

  it('shouldRejectAnswerWithoutText', async () => {
    const runtime = setup()

    const result = await executeSwarmCommand(runtime, 'answer clar-1')

    expect(result.kind).toBe('error')
    expect(runtime.answerClarification).not.toHaveBeenCalled()
  })

  it('shouldReportAServiceErrorAsAnErrorResultOnAnswer', async () => {
    const runtime = setup()
    runtime.answerClarification = vi.fn(async () => { throw new ServiceError('clarification-not-found', 'Clarification "clar-9" was not found.') })

    await expect(executeSwarmCommand(runtime, 'answer clar-9 text')).resolves.toEqual({
      kind: 'error',
      text: 'Clarification "clar-9" was not found.',
    })
  })

  it('shouldReportUsageForAnUnknownSubcommand', async () => {
    const runtime = setup()

    const result = await executeSwarmCommand(runtime, 'bogus')

    expect(result).toEqual({ kind: 'error', text: expect.stringContaining('Usage: /swarm') })
  })

  it('shouldCreateANewTaskInTheMasterLaneWithFullText', async () => {
    const runtime = setup()
    await expect(executeSwarmCommand(runtime, 'new build-parser Build the parser now')).resolves.toEqual({ kind: 'success', text: 'Created build-parser in specifier.' })
    expect(runtime.createTask).toHaveBeenCalledWith('build-parser', 'specifier', 'Build the parser now')
  })

  it('shouldListTasksAndRenderAnEmptyBoard', async () => {
    const runtime = setup()
    await expect(executeSwarmCommand(runtime, 'tasks')).resolves.toEqual({ kind: 'success', text: 'No board tasks.' })
    runtime.listTasks = vi.fn(async () => [{ name: 'build-parser', lane: 'coder', createdAt: 'then', updatedAt: 'now' }])
    await expect(executeSwarmCommand(runtime, 'tasks')).resolves.toEqual({ kind: 'success', text: '- build-parser [coder] updated now' })
  })

  it('shouldMoveAndReadATask', async () => {
    const runtime = setup()
    await expect(executeSwarmCommand(runtime, 'move build-parser coder')).resolves.toEqual({ kind: 'success', text: 'Moved build-parser to coder.' })
    await expect(executeSwarmCommand(runtime, 'task build-parser')).resolves.toEqual({ kind: 'success', text: 'task body' })
  })

  it('shouldRenderInboxAndOutboxSummaries', async () => {
    const runtime = setup()
    runtime.getInboxSummary = vi.fn(async (role: string) => ({ role, counts: { new: 2, inProcess: 1, completed: 3 }, pending: ['a.handoff'] }))
    runtime.getOutboxSummary = vi.fn(async (role: string) => ({ role, counts: { tmp: 1, sent: 4, failed: 1 }, pending: ['bad.failed.json'] }))
    await expect(executeSwarmCommand(runtime, 'inbox coder')).resolves.toEqual({ kind: 'success', text: 'coder inbox: new 2, in_process 1, completed 3\n- a.handoff' })
    await expect(executeSwarmCommand(runtime, 'outbox coder')).resolves.toEqual({ kind: 'success', text: 'coder outbox: tmp 1, sent 4, failed 1\n- bad.failed.json' })
  })

  it.each(['new only-name', 'move only-name', 'task', 'inbox', 'outbox'])('shouldReturnDidacticUsageForIncomplete %s', async (input) => {
    await expect(executeSwarmCommand(setup(), input)).resolves.toEqual({ kind: 'error', text: expect.stringContaining('Usage: /swarm') })
  })

  it('shouldRethrowANonServiceError', async () => {
    const runtime = setup()
    runtime.approve = vi.fn(async () => { throw new Error('boom') })

    await expect(executeSwarmCommand(runtime, 'approve ho-1')).rejects.toThrow('boom')
  })
})

describe('registerSwarmForgeCommand', () => {
  it('shouldRegisterASwarmCommandThatDelegatesToTheRuntime', async () => {
    const runtime = setup()
    const definitions: CommandDefinition[] = []
    const commands: CommandRegistrar = { register: (definition) => { definitions.push(definition); return () => undefined } }

    registerSwarmForgeCommand(commands, runtime)

    expect(definitions).toHaveLength(1)
    const [definition] = definitions
    expect(definition?.name).toBe('swarm')
    await expect(definition?.handler({ rawInput: 'approve ho-1' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'Approved ho-1 (ho-1.handoff).',
    })
  })
})
