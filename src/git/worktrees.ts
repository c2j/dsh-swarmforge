import { mkdir, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { NodeGitRunner, type GitRunner } from './runner.js'

export type WorktreeErrorKind = 'invalid-name' | 'stale-directory' | 'git-error'

export class WorktreeError extends Error {
  constructor(
    public readonly kind: WorktreeErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'WorktreeError'
  }
}

export interface EnsureWorktreeResult {
  readonly path: string
  readonly created: boolean
}

const defaultRunner = new NodeGitRunner()

export async function ensureWorktree(
  projectRoot: string,
  worktreeName: string,
  runner: GitRunner = defaultRunner,
): Promise<EnsureWorktreeResult> {
  if (worktreeName.length === 0 || worktreeName.includes('_')) {
    throw new WorktreeError('invalid-name', 'Worktree name must be non-empty and must not contain underscores.')
  }

  const path = join(projectRoot, '.worktrees', worktreeName)
  if (await directoryExists(path)) {
    const list = await runner.run(projectRoot, 'worktree', 'list', '--porcelain')
    if (list.code !== 0) throw gitError('Could not inspect registered worktrees', list.stderr)
    if (registeredPaths(list.stdout).has(await realpath(path))) return { path, created: false }

    throw new WorktreeError(
      'stale-directory',
      `Worktree directory exists but is not registered: ${path}. Inspect with "git worktree list --porcelain"; remove or repair it manually.`,
    )
  }

  await mkdir(join(projectRoot, '.worktrees'), { recursive: true })
  const added = await runner.run(
    projectRoot,
    'worktree',
    'add',
    '--force',
    '-B',
    `swarmforge-${worktreeName}`,
    path,
    'HEAD',
  )
  if (added.code !== 0) throw gitError('Could not create worktree', added.stderr)
  return { path, created: true }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function registeredPaths(output: string): Set<string> {
  return new Set(
    output
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice('worktree '.length))),
  )
}

function gitError(summary: string, stderr: string): WorktreeError {
  const detail = stderr.trim()
  return new WorktreeError('git-error', detail.length > 0 ? `${summary}: ${detail}` : summary)
}
