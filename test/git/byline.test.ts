import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { installCommitMsgHook } from '../../src/git/byline.js'
import { ensureWorktree } from '../../src/git/worktrees.js'
import { createGitFixture, type GitFixture } from './helpers.js'

async function writeRoster(fixture: GitFixture, rows: readonly string[]): Promise<void> {
  await mkdir(join(fixture.cwd, '.swarmforge'), { recursive: true })
  await fixture.write('.swarmforge/roles.tsv', `role\tworktree\treceive-mode\n${rows.join('\n')}\n`)
}

describe('installCommitMsgHook', () => {
  it('shouldInstallFreshExecutableHook', async () => {
    const fixture = await createGitFixture()

    try {
      const result = await installCommitMsgHook(fixture.cwd)
      const mode = (await stat(result.hookPath)).mode

      expect(result).toEqual({ installed: true, hookPath: join(fixture.cwd, '.git', 'hooks', 'commit-msg') })
      expect(mode & 0o111).not.toBe(0)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldRemainIdempotentForIdenticalHook', async () => {
    const fixture = await createGitFixture()

    try {
      const first = await installCommitMsgHook(fixture.cwd)
      const before = await readFile(first.hookPath, 'utf8')
      const second = await installCommitMsgHook(fixture.cwd)

      expect(second).toEqual({ installed: false, hookPath: first.hookPath })
      await expect(readFile(first.hookPath, 'utf8')).resolves.toBe(before)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldRefuseClobberForeignHook', async () => {
    const fixture = await createGitFixture()

    try {
      const hookPath = join(fixture.cwd, '.git', 'hooks', 'commit-msg')
      await writeFile(hookPath, '#!/bin/sh\nexit 0\n', 'utf8')

      await expect(installCommitMsgHook(fixture.cwd)).rejects.toMatchObject({
        kind: 'foreign-hook',
        message: expect.stringContaining(hookPath),
      })
      await expect(readFile(hookPath, 'utf8')).resolves.toBe('#!/bin/sh\nexit 0\n')
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('commit-msg byline hook', () => {
  it('shouldAppendBylineFromMasterCheckout', async () => {
    const fixture = await createGitFixture()

    try {
      await writeRoster(fixture, ['specifier\tmaster\ttask'])
      await installCommitMsgHook(fixture.cwd)
      await fixture.commit('subject')

      await expect(fixture.git('log', '-1', '--format=%B')).resolves.toBe('subject\n\nBy specifier.')
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldAppendBylineFromWorktreeCwd', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.commit('root')
      await writeRoster(fixture, ['specifier\tmaster\ttask', 'coder\tcoder\ttask'])
      const worktree = await ensureWorktree(fixture.cwd, 'coder')
      const installed = await installCommitMsgHook(fixture.cwd)
      const commonDir = await fixture.git('-C', worktree.path, 'rev-parse', '--git-common-dir')

      await fixture.git('-C', worktree.path, 'commit', '--allow-empty', '-q', '-m', 'worktree subject')

      expect(await realpath(installed.hookPath)).toBe(await realpath(join(commonDir, 'hooks', 'commit-msg')))
      await expect(fixture.git('-C', worktree.path, 'log', '-1', '--format=%B')).resolves.toBe(
        'worktree subject\n\nBy coder.',
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldLeaveExistingBylineOfAnyRoleUnchanged', async () => {
    const fixture = await createGitFixture()

    try {
      await writeRoster(fixture, ['specifier\tmaster\ttask'])
      await installCommitMsgHook(fixture.cwd)
      await fixture.commit('subject\n\nBy architect.')

      await expect(fixture.git('log', '-1', '--format=%B')).resolves.toBe('subject\n\nBy architect.')
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldFailOpenWithoutRosterFile', async () => {
    const fixture = await createGitFixture()

    try {
      await installCommitMsgHook(fixture.cwd)
      await fixture.commit('plain subject')

      await expect(fixture.git('log', '-1', '--format=%B')).resolves.toBe('plain subject')
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldFailOpenWithoutMatchingWorktree', async () => {
    const fixture = await createGitFixture()

    try {
      await writeRoster(fixture, ['coder\tcoder\ttask'])
      await installCommitMsgHook(fixture.cwd)
      await fixture.commit('unmatched subject')

      await expect(fixture.git('log', '-1', '--format=%B')).resolves.toBe('unmatched subject')
    } finally {
      await fixture.cleanup()
    }
  })
})
