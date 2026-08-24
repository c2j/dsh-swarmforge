import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureRuntimeState, parseRoster, SwarmForgeService, WAKE_TEXT, type GitOperations } from '../../src/service/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

interface ApprovalApi {
  listPendingApprovals(): Promise<readonly {
    readonly id: string
    readonly task: string
    readonly from: string
    readonly to: string
    readonly artifacts: string
    readonly file: string
  }[]>
  approve(id: string): Promise<{ readonly id: string; readonly file: string }>
  reject(id: string): Promise<{ readonly id: string }>
}

async function setup(rosterText = 'role specifier worktree=master\nrole coder worktree=none\nrole reviewer worktree=none') {
  const projectRoot = await mkdtemp(join(tmpdir(), 'swarmforge-approval-'))
  roots.push(projectRoot)
  const roster = parseRoster(rosterText, projectRoot)
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
    projectRoot, roster, gitOps, wake, now: () => new Date('2026-08-24T01:02:03.456Z'),
  })
  return { projectRoot, wake, service, approval: service as unknown as ApprovalApi }
}

describe('SwarmForgeService approval gate', () => {
  it('shouldHoldSpecifierPackMasterGitHandoff', async () => {
    const { projectRoot, wake, service, approval } = await setup()

    const sent = await service.sendHandoff('specifier', { type: 'git_handoff', to: 'coder', task: 'Build parser' })

    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/coder/inbox/new'))).toEqual([])
    expect(wake).not.toHaveBeenCalled()
    await expect(approval.listPendingApprovals()).resolves.toEqual([{
      id: sent.id, task: 'Build parser', from: 'specifier', to: 'coder', artifacts: 'src/a.ts', file: sent.file,
    }])
  })

  it('shouldNotHoldWhenRosterLacksSpecifier', async () => {
    const { projectRoot, wake, service } = await setup('role lead worktree=master\nrole coder worktree=none')
    const sent = await service.sendHandoff('lead', { type: 'git_handoff', to: 'coder', task: 'Build parser' })
    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/coder/inbox/new'))).toEqual([sent.file])
    expect(wake).toHaveBeenCalledWith('coder', WAKE_TEXT)
  })

  it('shouldNotHoldBroadcastHandoffs', async () => {
    const { projectRoot, wake, service } = await setup()
    const sent = await service.sendHandoff('specifier', { type: 'git_handoff', to: 'coder,reviewer', task: 'Build parser' })
    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/coder/inbox/new'))).toEqual([sent.file])
    expect(wake).toHaveBeenCalledTimes(2)
  })

  it('shouldNotHoldNotes', async () => {
    const { projectRoot, wake, service } = await setup()
    const sent = await service.sendHandoff('specifier', { type: 'note', to: 'coder', message: 'Please inspect.' })
    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/coder/inbox/new'))).toEqual([sent.file])
    expect(wake).toHaveBeenCalledWith('coder', WAKE_TEXT)
  })

  it('shouldStampApprovedHeaderBeforeBlankLine', async () => {
    const { projectRoot, wake, service, approval } = await setup()
    const held = await service.sendHandoff('specifier', { type: 'git_handoff', to: 'coder', task: 'Build parser' })

    await expect(approval.approve(held.id)).resolves.toEqual({ id: held.id, file: held.file })

    const delivered = await readFile(join(projectRoot, '.swarmforge/handoffs/coder/inbox/new', held.file), 'utf8')
    expect(delivered).toContain('approved: true\n\n')
    expect(wake).toHaveBeenCalledWith('coder', WAKE_TEXT)
  })

  it('shouldNeverReholdApprovedFiles', async () => {
    const { projectRoot, wake, service } = await setup()
    const file = '10_20260824T010203Z_000000_from_specifier_to_coder.handoff'
    await writeFile(join(projectRoot, '.swarmforge/handoffs/outbox', file), [
      'id: approved-id', 'from: specifier', 'to: coder', 'priority: 10', 'type: git_handoff',
      'role: specifier', 'task: Approved work', 'commit: abcdef1234', 'created_at: 2026-08-24T01:02:03.456Z',
      'approved: true', '', 'Re-read your role and constitution.', '', 'merge_and_process specifier abcdef1234',
    ].join('\n'), 'utf8')

    await service.processRootOutbox()

    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/pending_approval'))).toEqual([])
    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/coder/inbox/new'))).toEqual([file])
    expect(wake).toHaveBeenCalledWith('coder', WAKE_TEXT)
  })

  it('shouldRejectWriteMarkerAndWakeMaster', async () => {
    const { projectRoot, wake, service, approval } = await setup()
    const held = await service.sendHandoff('specifier', { type: 'git_handoff', to: 'coder', task: 'Build parser' })

    await expect(approval.reject(held.id)).resolves.toEqual({ id: held.id })

    expect(await readFile(join(projectRoot, '.swarmforge/notify/reject-Build parser'), 'utf8')).toBe('')
    expect(await readdir(join(projectRoot, '.swarmforge/handoffs/pending_approval'))).toEqual([])
    expect(wake).toHaveBeenCalledWith('specifier', 'Rejected: Build parser')
  })

  it('shouldErrorWhenApprovalIdIsNotFound', async () => {
    const { approval } = await setup()
    await expect(approval.approve('missing')).rejects.toMatchObject({ kind: 'approval-not-found' })
    await expect(approval.reject('missing')).rejects.toMatchObject({ kind: 'approval-not-found' })
  })
})
