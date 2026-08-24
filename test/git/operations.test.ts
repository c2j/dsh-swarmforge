import { describe, expect, it } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  GitOperationError,
  commitReachableFromHead,
  changedFiles,
  ensureRuntimeExcludes,
  mergeInto,
  validateCommit,
  worktreeHead,
} from '../../src/git/operations.js'
import type { GitRunner } from '../../src/git/runner.js'
import { createGitFixture } from './helpers.js'

describe('git commit operations', () => {
  it('shouldRejectNonHexCommit', async () => {
    const fixture = await createGitFixture()

    try {
      await expect(validateCommit(fixture.cwd, 'not-a-sha!')).rejects.toMatchObject({
        kind: 'invalid-format',
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldRejectCommitThatIsNotFound', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.commit()
      await expect(validateCommit(fixture.cwd, '0000000000')).rejects.toMatchObject({ kind: 'not-found' })
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldRejectAmbiguousCommit', async () => {
    const runner: GitRunner = {
      async run() {
        return { stdout: `${'a'.repeat(40)}\n${'b'.repeat(40)}\n`, stderr: 'ambiguous', code: 128 }
      },
    }

    await expect(validateCommit('/unused', 'abcdef1234', runner)).rejects.toEqual(
      new GitOperationError('ambiguous', 'Commit abcdef1234 is ambiguous.'),
    )
  })

  it('shouldRejectObjectThatIsNotACommit', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.write('blob.txt', 'blob contents')
      const blob = await fixture.git('hash-object', '-w', 'blob.txt')
      const abbreviation = blob.slice(0, 10)

      await expect(validateCommit(fixture.cwd, abbreviation)).rejects.toMatchObject({ kind: 'not-a-commit' })
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldReturnCanonicalTenHexCommit', async () => {
    const fixture = await createGitFixture()

    try {
      const head = await fixture.commit()
      await expect(validateCommit(fixture.cwd, head)).resolves.toBe(head)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldBackfillSenderWorktreeHeadAsTenHex', async () => {
    const fixture = await createGitFixture()

    try {
      const head = await fixture.commit()
      await expect(worktreeHead(fixture.cwd)).resolves.toBe(head)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldReportCommitReachableFromHead', async () => {
    const fixture = await createGitFixture()

    try {
      const ancestor = await fixture.commit('ancestor')
      await fixture.commit('head')
      await expect(commitReachableFromHead(fixture.cwd, ancestor)).resolves.toBe(true)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldReportCommitNotReachableFromHead', async () => {
    const fixture = await createGitFixture()

    try {
      const main = await fixture.commit('main')
      await fixture.git('checkout', '-q', '--orphan', 'detached-line')
      const other = await fixture.commit('other')
      await fixture.git('checkout', '-q', main)

      await expect(commitReachableFromHead(fixture.cwd, other)).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('runtime excludes', () => {
  it('shouldEnsureBothRuntimeDirectoriesInBothExcludeFiles', async () => {
    const fixture = await createGitFixture()

    try {
      await rm(join(fixture.cwd, '.git', 'info'), { recursive: true, force: true })
      const result = await ensureRuntimeExcludes(fixture.cwd)
      const gitignore = await readFile(join(fixture.cwd, '.gitignore'), 'utf8')
      const privateExclude = await readFile(join(fixture.cwd, '.git', 'info', 'exclude'), 'utf8')

      expect(result).toEqual({ gitignore: ['.swarmforge/', '.worktrees/'], gitInfoExclude: ['.swarmforge/', '.worktrees/'] })
      expect(gitignore).toBe('.swarmforge/\n.worktrees/\n')
      expect(privateExclude).toBe('.swarmforge/\n.worktrees/\n')
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldNotDuplicateRuntimeExcludesOnRepeatRuns', async () => {
    const fixture = await createGitFixture()

    try {
      await ensureRuntimeExcludes(fixture.cwd)
      const second = await ensureRuntimeExcludes(fixture.cwd)
      const gitignore = await readFile(join(fixture.cwd, '.gitignore'), 'utf8')

      expect(second).toEqual({ gitignore: [], gitInfoExclude: [] })
      expect(gitignore.match(/^\.swarmforge\/$/gmu)).toHaveLength(1)
      expect(gitignore.match(/^\.worktrees\/$/gmu)).toHaveLength(1)
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('changedFiles', () => {
  it('shouldListFilesChangedByCommit', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.commit('root')
      await fixture.write('alpha.txt', 'alpha\n')
      await fixture.write('beta.txt', 'beta\n')
      await fixture.git('add', 'alpha.txt', 'beta.txt')
      const commit = await fixture.commit('files')

      await expect(changedFiles(fixture.cwd, commit)).resolves.toEqual(['alpha.txt', 'beta.txt'])
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldReturnEmptyListForEmptyCommit', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.commit('root')
      const empty = await fixture.commit('empty')
      await expect(changedFiles(fixture.cwd, empty)).resolves.toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('mergeInto', () => {
  it('shouldSkipMergeWhenAlreadyAncestor', async () => {
    const fixture = await createGitFixture()

    try {
      const head = await fixture.commit()
      await expect(mergeInto(fixture.cwd, 'coder', head)).resolves.toEqual({ skipped: true })
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldMergeCommitWithExactMessage', async () => {
    const fixture = await createGitFixture()

    try {
      const base = await fixture.commit('base')
      await fixture.git('checkout', '-q', '-b', 'sender')
      await fixture.write('sender.txt', 'sender\n')
      await fixture.git('add', 'sender.txt')
      const sender = await fixture.commit('sender')
      const fullSender = await fixture.git('rev-parse', sender)
      await fixture.git('checkout', '-q', '-b', 'receiver', base)
      await fixture.write('receiver.txt', 'receiver\n')
      await fixture.git('add', 'receiver.txt')
      await fixture.commit('receiver')

      await expect(mergeInto(fixture.cwd, 'coder', sender)).resolves.toEqual({ skipped: false })
      await expect(fixture.git('log', '-1', '--format=%s')).resolves.toBe(`Merge coder ${sender}`)
      await expect(fixture.git('rev-parse', 'HEAD^2')).resolves.toBe(fullSender)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldReportMergeConflictWithoutAutoAbort', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.write('shared.txt', 'base\n')
      await fixture.git('add', 'shared.txt')
      const base = await fixture.commit('base')
      await fixture.git('checkout', '-q', '-b', 'sender')
      await fixture.write('shared.txt', 'sender\n')
      await fixture.git('add', 'shared.txt')
      const sender = await fixture.commit('sender')
      await fixture.git('checkout', '-q', '-b', 'receiver', base)
      await fixture.write('shared.txt', 'receiver\n')
      await fixture.git('add', 'shared.txt')
      await fixture.commit('receiver')

      await expect(mergeInto(fixture.cwd, 'coder', sender)).rejects.toMatchObject({
        conflict: true,
        stderrExcerpt: expect.stringContaining('CONFLICT'),
      })
      await expect(fixture.git('rev-parse', '--verify', 'MERGE_HEAD')).resolves.toMatch(/^[0-9a-f]{40}$/u)
    } finally {
      await fixture.cleanup()
    }
  })
})
