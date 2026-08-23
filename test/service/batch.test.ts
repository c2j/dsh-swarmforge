import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mergeInto } from '../../src/git/operations.js'
import { ensureRuntimeState, parseRoster, SwarmForgeService, type GitOperations } from '../../src/service/index.js'
import { createGitFixture } from '../git/helpers.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setup(overrides: Partial<GitOperations> = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'swarmforge-batch-'))
  roots.push(projectRoot)
  const roster = parseRoster('role lead worktree=master\nrole architect worktree=none mode=batch', projectRoot)
  await ensureRuntimeState(projectRoot, roster)
  const gitOps: GitOperations = {
    worktreeHead: vi.fn(async () => 'abcdef1234'), validateCommit: vi.fn(async (_cwd, commit) => commit),
    commitReachableFromHead: vi.fn(async () => true), changedFiles: vi.fn(async () => []),
    mergeInto: vi.fn(async () => ({ skipped: true })), ...overrides,
  }
  const service = new SwarmForgeService({
    projectRoot, roster, gitOps, wake: vi.fn(), now: () => new Date('2026-08-24T01:02:03.456Z'),
  })
  return { projectRoot, gitOps, service }
}

describe('SwarmForgeService batch receive mode', () => {
  it('shouldGroupSamePriorityIntoBatch', async () => {
    const { projectRoot, service } = await setup()
    await service.sendHandoff('lead', { type: 'note', to: 'architect', priority: '20', message: 'later' })
    await service.sendHandoff('lead', { type: 'note', to: 'architect', priority: '05', message: 'first' })
    await service.sendHandoff('lead', { type: 'note', to: 'architect', priority: '05', message: 'second' })

    await expect(service.readyForNext('architect')).resolves.toEqual({
      status: 'BATCH',
      items: [
        { from: 'lead', type: 'note', taskName: undefined, payload: 'first' },
        { from: 'lead', type: 'note', taskName: undefined, payload: 'second' },
      ],
    })
    const [batch] = await readdir(join(projectRoot, '.swarmforge/handoffs/architect/inbox/in_process'))
    expect(batch).toMatch(/^batch_20260824T010203Z_000000$/u)
    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/architect/inbox/new'))).toHaveLength(1)
    for (const file of await readdir(join(projectRoot, '.swarmforge/handoffs/architect/inbox/in_process', batch!))) {
      expect(await readFile(join(projectRoot, '.swarmforge/handoffs/architect/inbox/in_process', batch!, file), 'utf8'))
        .toContain('dequeued_at: 2026-08-24T01:02:03.456Z')
    }
  })

  it('shouldUseBatchDirectoryForOneQueuedFile', async () => {
    const { projectRoot, service } = await setup()
    await service.sendHandoff('lead', { type: 'note', to: 'architect', message: 'only' })
    await expect(service.readyForNext('architect')).resolves.toMatchObject({ status: 'BATCH', items: [{ payload: 'only' }] })
    const entries = await readdir(join(projectRoot, '.swarmforge/handoffs/architect/inbox/in_process'), { withFileTypes: true })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.isDirectory()).toBe(true)
  })

  it('shouldMergeBatchItemsInFilenameOrder', async () => {
    const fixture = await createGitFixture()
    try {
      const base = await fixture.commit('base')
      await fixture.git('checkout', '-q', '-b', 'sender')
      await fixture.write('first.txt', 'first\n'); await fixture.git('add', 'first.txt')
      const first = await fixture.commit('first')
      await fixture.write('second.txt', 'second\n'); await fixture.git('add', 'second.txt')
      const second = await fixture.commit('second')
      await fixture.git('checkout', '-q', '-b', 'receiver', base)
      const roster = parseRoster('role lead worktree=master\nrole architect worktree=none mode=batch', fixture.cwd)
      await ensureRuntimeState(fixture.cwd, roster)
      const merged: string[] = []
      const service = new SwarmForgeService({
        projectRoot: fixture.cwd, roster, wake: vi.fn(), now: () => new Date('2026-08-24T01:02:03.456Z'),
        gitOps: {
          worktreeHead: vi.fn(async () => first), validateCommit: vi.fn(async (_cwd, commit) => commit),
          commitReachableFromHead: vi.fn(async () => true), changedFiles: vi.fn(async () => []),
          mergeInto: async (cwd, sender, commit) => { merged.push(commit); return mergeInto(cwd, sender, commit) },
        },
      })
      await service.sendHandoff('lead', { type: 'git_handoff', to: 'architect', priority: '05', task: 'First', commit: first })
      await service.sendHandoff('lead', { type: 'git_handoff', to: 'architect', priority: '05', task: 'Second', commit: second })

      await service.readyForNext('architect')

      expect(merged).toEqual([first, second])
      await expect(fixture.git('rev-parse', '--short=10', 'HEAD')).resolves.toBe(second)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldKeepWholeBatchOnMergeConflict', async () => {
    const mergeIntoConflict = vi.fn(async () => { throw Object.assign(new Error('conflict'), { conflict: true }) })
    const { projectRoot, service } = await setup({ mergeInto: mergeIntoConflict })
    await service.sendHandoff('lead', { type: 'git_handoff', to: 'architect', priority: '05', task: 'First' })
    await service.sendHandoff('lead', { type: 'git_handoff', to: 'architect', priority: '05', task: 'Second' })

    await expect(service.readyForNext('architect')).rejects.toMatchObject({
      kind: 'merge-conflict', details: [expect.any(Error)], files: expect.any(Array),
    })
    const [batch] = await readdir(join(projectRoot, '.swarmforge/handoffs/architect/inbox/in_process'))
    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/architect/inbox/in_process', batch!))).toHaveLength(2)
  })

  it('shouldResumeInterruptedBatchWithoutRemerging', async () => {
    const { gitOps, service } = await setup()
    await service.sendHandoff('lead', { type: 'git_handoff', to: 'architect', task: 'Resume me' })
    await service.readyForNext('architect')
    vi.mocked(gitOps.mergeInto).mockClear()

    await expect(service.readyForNext('architect')).resolves.toMatchObject({ status: 'BATCH', items: [{ taskName: 'Resume me' }] })
    expect(gitOps.mergeInto).not.toHaveBeenCalled()
  })
})
