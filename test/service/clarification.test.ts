import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureRuntimeState, parseRoster, SwarmForgeService, type GitOperations } from '../../src/service/index.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function setup() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'swarmforge-clarify-'))
  roots.push(projectRoot)
  const roster = parseRoster('role lead worktree=master\nrole coder worktree=none', projectRoot)
  await ensureRuntimeState(projectRoot, roster)
  const gitOps: GitOperations = {
    worktreeHead: vi.fn(async () => 'abcdef1234'), validateCommit: vi.fn(async (_cwd, commit) => commit),
    commitReachableFromHead: vi.fn(async () => true), changedFiles: vi.fn(async () => []), mergeInto: vi.fn(async () => ({ skipped: true })),
  }
  const wake = vi.fn(async () => undefined)
  const options = { projectRoot, roster, gitOps, wake, now: () => new Date('2026-08-24T01:02:03.456Z') }
  const service = new SwarmForgeService(options)
  return { projectRoot, wake, service, options }
}

describe('SwarmForgeService clarifications', () => {
  it('shouldSubmitAndListClarificationsAcrossRestart', async () => {
    const { projectRoot, service, options } = await setup()
    const first = await service.submitClarification('coder', 'Which parser API?')
    const second = await service.submitClarification('coder', 'Which error format?')

    expect(first).toEqual({ clarificationId: 'clar-20260824T010203Z-000000' })
    expect(second).toEqual({ clarificationId: 'clar-20260824T010203Z-000001' })
    const restarted = new SwarmForgeService(options)
    await expect(restarted.listClarifications()).resolves.toEqual([
      { id: first.clarificationId, role: 'coder', question: 'Which parser API?', file: `${first.clarificationId}.request` },
      { id: second.clarificationId, role: 'coder', question: 'Which error format?', file: `${second.clarificationId}.request` },
    ])
    expect(await readFile(join(projectRoot, '.swarmforge/dashboard/clarifications/pending', `${first.clarificationId}.request`), 'utf8'))
      .toBe('role: coder\n\nWhich parser API?')
  })

  it('shouldWakeClarifiedRoleWithBracketedId', async () => {
    const { projectRoot, wake, service } = await setup()
    const { clarificationId } = await service.submitClarification('coder', 'Which parser API?')

    await expect(service.answerClarification(clarificationId, 'Use parseV2.')).resolves.toEqual({ clarificationId })

    expect(await readdir(join(projectRoot, '.swarmforge/dashboard/clarifications/pending'))).toEqual([])
    expect(await readdir(join(projectRoot, '.swarmforge/dashboard/clarifications/answered'))).toEqual([`${clarificationId}.request`])
    expect(wake).toHaveBeenCalledWith('coder', `[${clarificationId}] Use parseV2.`)
  })

  it('shouldRejectUnknownRoleAndMissingClarification', async () => {
    const { service } = await setup()
    await expect(service.submitClarification('missing', 'Question?')).rejects.toMatchObject({ kind: 'unknown-role' })
    await expect(service.answerClarification('missing', 'Answer')).rejects.toMatchObject({ kind: 'clarification-not-found' })
  })

  it('shouldRejectClarificationQuestionLongerThan500Characters', async () => {
    const { service } = await setup()
    await expect(service.submitClarification('coder', 'x'.repeat(501))).rejects.toMatchObject({ kind: 'invalid-clarification' })
  })
})
