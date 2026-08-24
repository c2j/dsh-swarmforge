import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const gitEnvironment: Readonly<Record<string, string | undefined>> = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'SwarmForge Test',
  GIT_AUTHOR_EMAIL: 'swarmforge@example.invalid',
  GIT_COMMITTER_NAME: 'SwarmForge Test',
  GIT_COMMITTER_EMAIL: 'swarmforge@example.invalid',
}

export interface GitFixture {
  readonly cwd: string
  git(...args: string[]): Promise<string>
  commit(message?: string): Promise<string>
  write(relativePath: string, contents: string): Promise<void>
  cleanup(): Promise<void>
}

export async function createGitFixture(): Promise<GitFixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'swarmforge-git-'))

  const git = async (...args: string[]): Promise<string> => {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd,
        env: gitEnvironment,
        timeout: 10_000,
        encoding: 'utf8',
      }, (error, stdout) => {
        if (error !== null) reject(error)
        else resolve(stdout.trim())
      })
    })
  }

  await git('init', '-q')
  await git('config', 'user.email', 'swarmforge@example.invalid')
  await git('config', 'user.name', 'SwarmForge Test')
  await git('config', 'commit.gpgsign', 'false')
  await git('config', 'core.abbrev', '10')

  return {
    cwd,
    git,
    async commit(message = 'fixture commit'): Promise<string> {
      await git('commit', '--allow-empty', '-q', '-m', message)
      return git('rev-parse', '--short=10', 'HEAD')
    },
    async write(relativePath: string, contents: string): Promise<void> {
      await writeFile(join(cwd, relativePath), contents, 'utf8')
    },
    async cleanup(): Promise<void> {
      await rm(cwd, { recursive: true, force: true })
    },
  }
}
