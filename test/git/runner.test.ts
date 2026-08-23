import { describe, expect, it } from 'vitest'

import { NodeGitRunner } from '../../src/git/runner.js'
import { createGitFixture } from './helpers.js'

describe('NodeGitRunner', () => {
  it('shouldRunGitWithExplicitWorkingDirectory', async () => {
    const fixture = await createGitFixture()

    try {
      const result = await new NodeGitRunner().run(fixture.cwd, 'rev-parse', '--is-inside-work-tree')

      expect(result).toEqual({ stdout: 'true\n', stderr: '', code: 0 })
    } finally {
      await fixture.cleanup()
    }
  })

  it('shouldReturnNonZeroGitResultsWithoutThrowing', async () => {
    const fixture = await createGitFixture()

    try {
      const result = await new NodeGitRunner().run(fixture.cwd, 'rev-parse', '--verify', 'missing')

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('fatal:')
    } finally {
      await fixture.cleanup()
    }
  })
})
