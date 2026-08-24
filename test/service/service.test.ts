import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ServiceError,
  SwarmForgeService,
  WAKE_TEXT,
  ensureRuntimeState,
  parseRoster,
  type GitOperations,
} from '../../src/service/index.js'
import { parseDeliveredHandoff } from '../../src/protocol/index.js'
import { mergeInto } from '../../src/git/operations.js'
import { createGitFixture } from '../git/helpers.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setup(overrides: Partial<GitOperations> = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'swarmforge-service-'))
  roots.push(projectRoot)
  const roster = parseRoster(`
role lead worktree=master
role coder worktree=none
role reviewer worktree=none
`, projectRoot)
  await ensureRuntimeState(projectRoot, roster)
  const gitOps: GitOperations = {
    worktreeHead: vi.fn(async () => 'abcdef1234'),
    validateCommit: vi.fn(async (_cwd, commit) => commit),
    commitReachableFromHead: vi.fn(async () => true),
    changedFiles: vi.fn(async () => ['src/a.ts', 'src/b.ts']),
    mergeInto: vi.fn(async () => ({ skipped: true })),
    ...overrides,
  }
  const wake = vi.fn(async () => undefined)
  const service = new SwarmForgeService({
    projectRoot,
    roster,
    gitOps,
    wake,
    now: () => new Date('2026-08-23T12:34:56.789Z'),
  })
  return { projectRoot, roster, gitOps, wake, service }
}

describe('SwarmForgeService.sendHandoff', () => {
  it('shouldDeliverToEveryRecipientInboxAtomically', async () => {
    const { projectRoot, wake, service } = await setup()

    const result = await service.sendHandoff('lead', {
      type: 'note', to: 'coder,reviewer', priority: '07', message: 'Please inspect.',
    })

    expect(result.file).toMatch(/^07_20260823T123456Z_000000_from_lead_to_coder_reviewer\.handoff$/u)
    for (const recipient of ['coder', 'reviewer']) {
      const content = await readFile(join(projectRoot, '.swarmforge', 'handoffs', recipient, 'inbox/new', result.file), 'utf8')
      const parsed = parseDeliveredHandoff(content)
      expect(parsed).toMatchObject({ ok: true, value: { recipient, enqueued_at: '2026-08-23T12:34:56.789Z' } })
    }
    expect(await readdir(join(projectRoot, '.swarmforge', 'handoffs', 'lead', 'outbox/tmp'))).toEqual([])
    expect(await readdir(join(projectRoot, '.swarmforge', 'handoffs', 'lead', 'outbox/sent'))).toEqual([result.file])
    expect(wake.mock.calls).toEqual([['coder', WAKE_TEXT], ['reviewer', WAKE_TEXT]])
  })

  it('shouldBackfillHeadAndArtifactsForGitHandoff', async () => {
    const { projectRoot, gitOps, service } = await setup()
    const result = await service.sendHandoff('lead', { type: 'git_handoff', to: 'coder', task: 'Build parser' })
    const content = await readFile(join(projectRoot, '.swarmforge', 'handoffs/lead/outbox/sent', result.file), 'utf8')

    expect(gitOps.worktreeHead).toHaveBeenCalledWith(projectRoot)
    expect(gitOps.validateCommit).not.toHaveBeenCalled()
    expect(gitOps.changedFiles).toHaveBeenCalledWith(projectRoot, 'abcdef1234')
    expect(content).toContain('commit: abcdef1234\nartifacts: src/a.ts,src/b.ts')
  })

  it('shouldValidateSuppliedCommitAndRequireReachability', async () => {
    const { projectRoot, gitOps, service } = await setup({ commitReachableFromHead: vi.fn(async () => false) })

    await expect(service.sendHandoff('lead', {
      type: 'git_handoff', to: 'coder', task: 'Build parser', commit: '1234567890',
    })).rejects.toMatchObject({ kind: 'commit-not-reachable' })
    expect(gitOps.validateCommit).toHaveBeenCalledWith(projectRoot, '1234567890')
    expect(gitOps.worktreeHead).not.toHaveBeenCalled()
  })

  it('shouldArchiveInvalidDraftInFailedWithStructuredError', async () => {
    const { projectRoot, service } = await setup()

    await expect(service.sendHandoff('lead', { type: 'note', to: 'missing' })).rejects.toBeInstanceOf(ServiceError)
    expect(await readdir(join(projectRoot, '.swarmforge', 'handoffs/lead/outbox/failed'))).toHaveLength(1)
  })

  it('shouldNotCollideFilenamesUnderConcurrentSends', async () => {
    const { service } = await setup()
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => service.sendHandoff('lead', {
      type: 'note', to: 'coder', message: `Message ${index}`,
    })))

    expect(new Set(results.map(({ file }) => file)).size).toBe(20)
    expect(results.map(({ file }) => file)).toEqual([...results.map(({ file }) => file)].sort())
  })
})

describe('SwarmForgeService inbox lifecycle', () => {
  it('shouldClaimLexicographicallyFirstNewFileAndStampDequeue', async () => {
    const { projectRoot, service } = await setup()
    const later = await service.sendHandoff('lead', { type: 'note', to: 'coder', priority: '90', message: 'Later' })
    const first = await service.sendHandoff('lead', { type: 'note', to: 'coder', priority: '01', message: 'First' })

    const result = await service.readyForNext('coder')

    expect(result).toMatchObject({ status: 'TASK', from: 'lead', type: 'note', priority: '01', payload: 'First', file: first.file })
    expect(await readdir(join(projectRoot, '.swarmforge', 'handoffs/coder/inbox/new'))).toEqual([later.file])
    const claimed = await readFile(join(projectRoot, '.swarmforge', 'handoffs/coder/inbox/in_process', first.file), 'utf8')
    expect(claimed).toContain('dequeued_at: 2026-08-23T12:34:56.789Z')
  })

  it('shouldResumeSingleInProcessFile', async () => {
    const { gitOps, service } = await setup()
    await service.sendHandoff('lead', { type: 'git_handoff', to: 'coder', task: 'Continue work' })
    await service.readyForNext('coder')
    vi.mocked(gitOps.mergeInto).mockClear()

    await expect(service.readyForNext('coder')).resolves.toMatchObject({ status: 'RESUME', taskName: 'Continue work' })
    expect(gitOps.mergeInto).not.toHaveBeenCalled()
  })

  it('shouldRejectAmbiguousInProcessFiles', async () => {
    const { projectRoot, service } = await setup()
    const directory = join(projectRoot, '.swarmforge', 'handoffs/coder/inbox/in_process')
    await writeFile(join(directory, 'one.handoff'), 'one', 'utf8')
    await writeFile(join(directory, 'two.handoff'), 'two', 'utf8')

    await expect(service.readyForNext('coder')).rejects.toMatchObject({ kind: 'ambiguous-in-process' })
  })

  it('shouldMergeGitHandoffBeforeReturningTaskUsingRealGit', async () => {
    const fixture = await createGitFixture()
    try {
      const base = await fixture.commit('base')
      await fixture.git('checkout', '-q', '-b', 'sender')
      await fixture.write('sender.txt', 'sender\n')
      await fixture.git('add', 'sender.txt')
      const senderCommit = await fixture.commit('sender')
      await fixture.git('checkout', '-q', '-b', 'receiver', base)
      const serviceWithGitCwd = new SwarmForgeService({
        projectRoot: fixture.cwd,
        roster: parseRoster('role lead worktree=master\nrole coder worktree=none', fixture.cwd),
        gitOps: {
          worktreeHead: vi.fn(async () => senderCommit), validateCommit: vi.fn(async (_cwd, commit) => commit),
          commitReachableFromHead: vi.fn(async () => true), changedFiles: vi.fn(async () => ['sender.txt']), mergeInto,
        },
        wake: vi.fn(), now: () => new Date('2026-08-23T12:34:56.789Z'),
      })
      await ensureRuntimeState(fixture.cwd, parseRoster('role lead worktree=master\nrole coder worktree=none', fixture.cwd))
      await serviceWithGitCwd.sendHandoff('lead', { type: 'git_handoff', to: 'coder', task: 'Merge work' })

      await expect(serviceWithGitCwd.readyForNext('coder')).resolves.toMatchObject({ status: 'TASK', taskName: 'Merge work' })
      await expect(fixture.git('rev-parse', '--short=10', 'HEAD')).resolves.toBe(senderCommit)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldKeepFileInProcessOnMergeConflict', async () => {
    const { projectRoot, service } = await setup({ mergeInto: vi.fn(async () => { throw Object.assign(new Error('conflict'), { conflict: true }) }) })
    const sent = await service.sendHandoff('lead', { type: 'git_handoff', to: 'coder', task: 'Conflict task' })

    await expect(service.readyForNext('coder')).rejects.toMatchObject({ kind: 'merge-conflict', file: sent.file })
    expect(await readdir(join(projectRoot, '.swarmforge', 'handoffs/coder/inbox/in_process'))).toEqual([sent.file])
  })

  it('shouldCompleteCurrentFileAndThenReturnNoTask', async () => {
    const { projectRoot, service } = await setup()
    const sent = await service.sendHandoff('lead', { type: 'note', to: 'coder', message: 'One task' })
    await service.readyForNext('coder')

    await expect(service.doneWithCurrent('coder')).resolves.toEqual({ file: sent.file })
    const completed = await readFile(join(projectRoot, '.swarmforge', 'handoffs/coder/inbox/completed', sent.file), 'utf8')
    expect(completed).toContain('completed_at: 2026-08-23T12:34:56.789Z')
    await expect(service.readyForNext('coder')).resolves.toEqual({ status: 'NO_TASK' })
    await expect(service.doneWithCurrent('coder')).rejects.toMatchObject({ kind: 'no-current-task' })
  })
})

describe('SwarmForgeService.processRootOutbox', () => {
  it('shouldDeliverHandPlacedNewTaskNoteAndArchiveToRootSent', async () => {
    const { projectRoot, wake, service } = await setup()
    const file = '10_20260823T120000Z_000000_from_(New Task)_to_coder.handoff'
    const content = [
      'id: 20260823T120000Z_000000_from_(New Task)',
      'from: (New Task)',
      'to: coder',
      'priority: 10',
      'type: note',
      'role: (New Task)',
      'task: Bootstrap',
      'created_at: 2026-08-23T12:00:00.000Z',
      '',
      'Re-read your role and constitution.',
      '',
      'Begin bootstrap.',
    ].join('\n')
    await writeFile(join(projectRoot, '.swarmforge', 'handoffs/outbox', file), content, 'utf8')

    await expect(service.processRootOutbox()).resolves.toEqual({ processed: [file] })

    const delivered = await readFile(join(projectRoot, '.swarmforge', 'handoffs/coder/inbox/new', file), 'utf8')
    expect(delivered).toContain('recipient: coder')
    expect(await readdir(join(projectRoot, '.swarmforge', 'handoffs/outbox'))).toEqual(['sent'])
    expect(await readdir(join(projectRoot, '.swarmforge', 'handoffs/outbox/sent'))).toEqual([file])
    expect(wake).toHaveBeenCalledWith('coder', WAKE_TEXT)
  })
})
