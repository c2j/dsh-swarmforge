import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  RosterValidationError,
  ensureRuntimeState,
  parseRoster,
} from '../../src/service/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'swarmforge-service-'))
  roots.push(root)
  return root
}

describe('parseRoster', () => {
  it('shouldParseCommentsDefaultsPerRoleRoutingAndRuntimeCwd', async () => {
    const projectRoot = await temporaryProject()
    const roster = parseRoster(`
# fixed team
role lead worktree=master provider=openai model=gpt-5
role code-reviewer worktree=none mode=batch model=deepseek-chat
`, projectRoot)

    expect(roster.roles).toEqual([
      { name: 'lead', worktree: 'master', mode: 'task', provider: 'openai', model: 'gpt-5', cwd: projectRoot },
      { name: 'code-reviewer', worktree: 'none', mode: 'batch', model: 'deepseek-chat', cwd: projectRoot },
    ])
    expect(roster.byRole.get('code-reviewer')).toBe(roster.roles[1])
  })

  it('shouldRejectConfWithUnderscoreRole', () => {
    expect(() => parseRoster('role bad_role worktree=master', '/project')).toThrowError(
      expect.objectContaining({ problems: expect.arrayContaining([expect.stringContaining('bad_role')]) }),
    )
  })

  it('shouldRequireExactlyOneMaster', () => {
    expect(() => parseRoster('role coder worktree=none', '/project')).toThrowError(
      expect.objectContaining({ problems: [expect.stringContaining('exactly one')] }),
    )
    expect(() => parseRoster('role a worktree=master\nrole b worktree=master', '/project')).toThrowError(
      expect.objectContaining({ problems: expect.arrayContaining([expect.stringContaining('exactly one')]) }),
    )
  })

  it('shouldAggregateEveryRosterProblem', () => {
    try {
      parseRoster(`
role bad_role worktree=shared mode=wrong surprise=yes
role bad_role worktree=shared
not-role other
`, '/project')
      throw new Error('expected roster validation to fail')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RosterValidationError)
      if (!(error instanceof RosterValidationError)) return
      expect(error.problems).toHaveLength(8)
      expect(error.problems.join('\n')).toContain('unknown field "surprise"')
      expect(error.problems.join('\n')).toContain('duplicate role')
      expect(error.problems.join('\n')).toContain('duplicate worktree')
      expect(error.problems.join('\n')).toContain('must start with role')
    }
  })

  it('shouldAllowRepeatedNoneWorktrees', () => {
    expect(() => parseRoster(`
role lead worktree=master
role coder worktree=none
role reviewer worktree=none
`, '/project')).not.toThrow()
  })

  it('shouldUseResolveCwdSeamForEveryRole', () => {
    const roster = parseRoster('role lead worktree=master', '/project', (role, root) => `${root}/${role.name}`)
    expect(roster.roles[0]?.cwd).toBe('/project/lead')
  })

  it('shouldRejectEmptyOrWhitespaceBearingModelRoutingValues', () => {
    expect(() => parseRoster('role lead worktree=master model=', '/project')).toThrowError(
      expect.objectContaining({ problems: expect.arrayContaining([expect.stringContaining('model')]) }),
    )
    expect(() => parseRoster('role lead worktree=master provider=', '/project')).toThrowError(
      expect.objectContaining({ problems: expect.arrayContaining([expect.stringContaining('provider')]) }),
    )
  })
})

describe('ensureRuntimeState', () => {
  it('shouldCreateEveryRuntimeDirectoryAndRosterSnapshotIdempotently', async () => {
    const projectRoot = await temporaryProject()
    const roster = parseRoster('role lead worktree=master\nrole coder worktree=none mode=batch', projectRoot)

    await ensureRuntimeState(projectRoot, roster)
    await ensureRuntimeState(projectRoot, roster)

    const relativeDirectories = [
      'handoffs/lead/outbox/tmp', 'handoffs/lead/outbox/sent', 'handoffs/lead/outbox/failed',
      'handoffs/lead/inbox/new', 'handoffs/lead/inbox/in_process', 'handoffs/lead/inbox/completed',
      'handoffs/coder/outbox/tmp', 'handoffs/coder/outbox/sent', 'handoffs/coder/outbox/failed',
      'handoffs/coder/inbox/new', 'handoffs/coder/inbox/in_process', 'handoffs/coder/inbox/completed',
      'handoffs/pending_approval', 'handoffs/outbox',
    ]
    for (const relative of relativeDirectories) {
      expect((await stat(join(projectRoot, '.swarmforge', relative))).isDirectory()).toBe(true)
    }
    await expect(readFile(join(projectRoot, '.swarmforge', 'roles.tsv'), 'utf8')).resolves.toBe(
      'role\tworktree\treceive-mode\nlead\tmaster\ttask\ncoder\tnone\tbatch\n',
    )
  })

  it('shouldPersistAndReloadDeterministicAnchorSessionIds', async () => {
    const projectRoot = await temporaryProject()
    const { readAnchorIds, writeAnchorIds } = await import('../../src/service/index.js')

    await expect(readAnchorIds(projectRoot)).resolves.toEqual(new Map())
    await writeAnchorIds(projectRoot, new Map([['lead', 'swarmforge-anchor-parent-lead'], ['coder', 'swarmforge-anchor-parent-coder']]))

    await expect(readAnchorIds(projectRoot)).resolves.toEqual(new Map([
      ['lead', 'swarmforge-anchor-parent-lead'],
      ['coder', 'swarmforge-anchor-parent-coder'],
    ]))
  })
})
