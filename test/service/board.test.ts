import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureRuntimeState, parseRoster, ServiceError, SwarmForgeService, WAKE_TEXT, type GitOperations } from '../../src/service/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'swarmforge-board-'))
  roots.push(projectRoot)
  const roster = parseRoster('role specifier worktree=master\nrole coder worktree=none\nrole architect worktree=none', projectRoot)
  await ensureRuntimeState(projectRoot, roster)
  const gitOps: GitOperations = {
    worktreeHead: vi.fn(async () => 'abcdef1234'),
    validateCommit: vi.fn(async (_cwd, commit) => commit),
    commitReachableFromHead: vi.fn(async () => true),
    changedFiles: vi.fn(async () => ['src/a.ts']),
    mergeInto: vi.fn(async () => ({ skipped: true })),
  }
  const wake = vi.fn(async () => undefined)
  const service = new SwarmForgeService({
    projectRoot, roster, gitOps, wake, now: () => new Date('2026-08-24T10:11:12.345Z'),
  })
  return { projectRoot, wake, service, options: { projectRoot, roster, gitOps, wake, now: () => new Date('2026-08-24T10:11:12.345Z') } }
}

describe('SwarmForgeService board', () => {
  it('shouldCreateAFormatFaithfulPersistentTaskAndInjectNewTaskNote', async () => {
    const { projectRoot, wake, service } = await setup()

    await expect(service.createTask('build-parser', 'specifier', 'Build the parser.\nPreserve comments.')).resolves.toEqual({
      name: 'build-parser', lane: 'specifier', createdAt: '2026-08-24T10:11:12.345Z', updatedAt: '2026-08-24T10:11:12.345Z',
    })

    expect(await readFile(join(projectRoot, '.swarmforge/board/tasks.tsv'), 'utf8')).toBe('build-parser\tspecifier\t2026-08-24T10:11:12.345Z\t2026-08-24T10:11:12.345Z\n')
    expect(await service.getTaskBody('build-parser')).toBe('Build the parser.\nPreserve comments.')
    const inbox = await readdir(join(projectRoot, '.swarmforge/handoffs/specifier/inbox/new'))
    expect(inbox).toHaveLength(1)
    const note = await readFile(join(projectRoot, '.swarmforge/handoffs/specifier/inbox/new', inbox[0]!), 'utf8')
    expect(note).toContain('from: (New Task)\nto: specifier\nrecipient: specifier\npriority: 50\ntype: note\nrole: (New Task)\ntask: build-parser')
    expect(note).toContain('\n\nRe-read your role and constitution.\n\nBuild the parser.\nPreserve comments.')
    expect(wake).toHaveBeenCalledWith('specifier', WAKE_TEXT)
  })

  it.each([
    ['', 'Task name is required'],
    ['Not Kebab', 'kebab-case'],
    ['a'.repeat(81), 'at most 80'],
  ])('shouldRejectInvalidTaskName %j', async (name, message) => {
    const { service } = await setup()
    await expect(service.createTask(name, 'specifier', 'text')).rejects.toThrow(message)
  })

  it('shouldRejectUnknownLaneAndDuplicateName', async () => {
    const { service } = await setup()
    await expect(service.createTask('one-task', 'missing', 'text')).rejects.toMatchObject({ kind: 'unknown-role' })
    await service.createTask('one-task', 'specifier', 'text')
    await expect(service.createTask('one-task', 'specifier', 'again')).rejects.toMatchObject({ kind: 'task-exists' })
  })

  it('shouldListMoveDeleteAndSurviveRestart', async () => {
    const { projectRoot, service, options } = await setup()
    await service.createTask('one-task', 'specifier', 'body')
    const restarted = new SwarmForgeService({ ...options, now: () => new Date('2026-08-24T11:00:00.000Z') })

    await expect(restarted.listTasks()).resolves.toEqual([{
      name: 'one-task', lane: 'specifier', createdAt: '2026-08-24T10:11:12.345Z', updatedAt: '2026-08-24T10:11:12.345Z',
    }])
    await expect(restarted.moveTask('one-task', 'coder')).resolves.toMatchObject({ lane: 'coder', createdAt: '2026-08-24T10:11:12.345Z', updatedAt: '2026-08-24T11:00:00.000Z' })
    expect(await readFile(join(projectRoot, '.swarmforge/board/tasks.tsv'), 'utf8')).toContain('one-task\tcoder\t2026-08-24T10:11:12.345Z\t2026-08-24T11:00:00.000Z')
    await restarted.deleteTask('one-task')
    await expect(restarted.listTasks()).resolves.toEqual([])
    await expect(restarted.getTaskBody('one-task')).rejects.toMatchObject({ kind: 'task-not-found' })
  })

  it('shouldMoveAnExistingCardToTheFirstRecipientAfterDeliveredHandoff', async () => {
    const { service } = await setup()
    await service.createTask('flow-task', 'specifier', 'body')

    await service.sendHandoff('specifier', { type: 'note', to: 'coder,architect', task: 'flow-task', message: 'Continue.' })

    await expect(service.listTasks()).resolves.toEqual([expect.objectContaining({ name: 'flow-task', lane: 'coder' })])
  })

  it('shouldExposePerRoleInboxAndOutboxSummaries', async () => {
    const { service } = await setup()
    await service.sendHandoff('specifier', { type: 'note', to: 'coder', message: 'Continue.' })

    await expect(service.getInboxSummary('coder')).resolves.toMatchObject({ role: 'coder', counts: { new: 1, inProcess: 0, completed: 0 }, pending: [expect.stringMatching(/\.handoff$/u)] })
    await expect(service.getOutboxSummary('specifier')).resolves.toMatchObject({ role: 'specifier', counts: { tmp: 0, sent: 1, failed: 0 }, pending: [] })
    await expect(service.getInboxSummary('missing')).rejects.toBeInstanceOf(ServiceError)
  })
})
