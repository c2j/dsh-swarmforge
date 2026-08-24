import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ensureWorktree } from '../../src/git/worktrees.js'
import { createGitFixture } from './helpers.js'

describe('ensureWorktree', () => {
  it('shouldCreateWorktreeWithSwarmforgeBranch', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.commit('root')
      const result = await ensureWorktree(fixture.cwd, 'coder')

      expect(result).toEqual({ path: join(fixture.cwd, '.worktrees', 'coder'), created: true })
      await expect(fixture.git('-C', result.path, 'branch', '--show-current')).resolves.toBe('swarmforge-coder')
      await expect(fixture.git('worktree', 'list', '--porcelain')).resolves.toContain(`worktree ${await realpath(result.path)}`)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldReuseRegisteredWorktree', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.commit('root')
      const first = await ensureWorktree(fixture.cwd, 'coder')
      const second = await ensureWorktree(fixture.cwd, 'coder')

      expect(first.created).toBe(true)
      expect(second).toEqual({ path: first.path, created: false })
      await expect(fixture.git('worktree', 'list', '--porcelain')).resolves.toContain(`worktree ${await realpath(first.path)}`)
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldRejectStaleUnregisteredDirectory', async () => {
    const fixture = await createGitFixture()

    try {
      await fixture.commit('root')
      await mkdir(join(fixture.cwd, '.worktrees', 'coder'), { recursive: true })

      await expect(ensureWorktree(fixture.cwd, 'coder')).rejects.toMatchObject({
        kind: 'stale-directory',
        message: expect.stringContaining('git worktree list'),
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it.each(['', 'code_reviewer'])('shouldRejectInvalidWorktreeName(%j)', async (name) => {
    const fixture = await createGitFixture()

    try {
      await expect(ensureWorktree(fixture.cwd, name)).rejects.toMatchObject({ kind: 'invalid-name' })
    } finally {
      await fixture.cleanup()
    }
  })
})
