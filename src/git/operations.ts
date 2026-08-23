import { NodeGitRunner, type GitRunner } from './runner.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface EnsureRuntimeExcludesResult {
  readonly gitignore: readonly string[]
  readonly gitInfoExclude: readonly string[]
}

export type GitOperationErrorKind = 'invalid-format' | 'ambiguous' | 'not-found' | 'not-a-commit' | 'git-error'

export class GitOperationError extends Error {
  constructor(
    public readonly kind: GitOperationErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'GitOperationError'
  }
}

export class GitMergeConflictError extends Error {
  readonly conflict = true

  constructor(public readonly stderrExcerpt: string) {
    super(`Merge conflict: ${stderrExcerpt}`)
    this.name = 'GitMergeConflictError'
  }
}

export interface MergeResult {
  readonly skipped: boolean
}

const defaultRunner = new NodeGitRunner()

export async function validateCommit(
  cwd: string,
  abbrev: string,
  runner: GitRunner = defaultRunner,
): Promise<string> {
  if (!/^[0-9a-fA-F]{10}$/.test(abbrev)) {
    throw new GitOperationError('invalid-format', 'Commit must be exactly 10 hexadecimal characters.')
  }

  const resolution = await runner.run(cwd, 'rev-parse', `--disambiguate=${abbrev}`, abbrev)
  const objects = [
    ...new Set(nonEmptyLines(resolution.stdout).filter((line) => /^[0-9a-fA-F]{40,64}$/.test(line))),
  ]

  if (objects.length > 1) {
    throw new GitOperationError('ambiguous', `Commit ${abbrev} is ambiguous.`)
  }
  const full = objects[0]
  if (full === undefined) {
    throw new GitOperationError('not-found', `Commit ${abbrev} was not found.`)
  }

  const type = await runner.run(cwd, 'cat-file', '-t', full)
  if (type.code !== 0) {
    throw gitError('Could not inspect commit', type.stderr)
  }
  if (type.stdout.trim() !== 'commit') {
    throw new GitOperationError('not-a-commit', `Object ${abbrev} is not a commit.`)
  }

  const canonical = await runner.run(cwd, 'rev-parse', '--short=10', full)
  if (canonical.code !== 0) {
    throw gitError('Could not canonicalize commit', canonical.stderr)
  }
  return canonical.stdout.trim()
}

export async function worktreeHead(cwd: string, runner: GitRunner = defaultRunner): Promise<string> {
  const result = await runner.run(cwd, 'rev-parse', '--short=10', 'HEAD')
  if (result.code !== 0) {
    throw gitError('Could not resolve worktree HEAD', result.stderr)
  }
  return result.stdout.trim()
}

export async function commitReachableFromHead(
  cwd: string,
  sha10: string,
  runner: GitRunner = defaultRunner,
): Promise<boolean> {
  const result = await runner.run(cwd, 'merge-base', '--is-ancestor', sha10, 'HEAD')
  if (result.code === 0) return true
  if (result.code === 1) return false
  throw gitError('Could not determine commit reachability', result.stderr)
}

export async function mergeInto(
  cwd: string,
  senderRole: string,
  sha10: string,
  runner: GitRunner = defaultRunner,
): Promise<MergeResult> {
  if (await commitReachableFromHead(cwd, sha10, runner)) {
    return { skipped: true }
  }

  const full = await runner.run(cwd, 'rev-parse', '--verify', `${sha10}^{commit}`)
  if (full.code !== 0) {
    throw gitError('Could not resolve merge commit', full.stderr)
  }

  const merge = await runner.run(
    cwd,
    'merge',
    '--no-edit',
    '-m',
    `Merge ${senderRole} ${sha10}`,
    full.stdout.trim(),
  )
  if (merge.code !== 0) {
    throw new GitMergeConflictError(excerpt([merge.stdout, merge.stderr].filter(Boolean).join('\n')))
  }
  return { skipped: false }
}

export async function ensureRuntimeExcludes(projectRoot: string): Promise<EnsureRuntimeExcludesResult> {
  const gitignore = await ensureLines(join(projectRoot, '.gitignore'))
  const gitInfoExclude = await ensureLines(join(projectRoot, '.git', 'info', 'exclude'))
  return { gitignore, gitInfoExclude }
}

export async function changedFiles(
  cwd: string,
  sha10: string,
  runner: GitRunner = defaultRunner,
): Promise<string[]> {
  const result = await runner.run(cwd, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha10)
  if (result.code !== 0) {
    throw gitError('Could not list changed files', result.stderr)
  }
  return nonEmptyLines(result.stdout)
}

function nonEmptyLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0)
}

function gitError(summary: string, stderr: string): GitOperationError {
  const detail = stderr.trim()
  return new GitOperationError('git-error', detail.length > 0 ? `${summary}: ${detail}` : summary)
}

function excerpt(output: string): string {
  const normalized = output.trim()
  return normalized.length <= 1_000 ? normalized : `${normalized.slice(0, 997)}...`
}

const runtimeExcludes = ['.swarmforge/', '.worktrees/'] as const

async function ensureLines(path: string): Promise<string[]> {
  let content = ''
  try {
    content = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error
  }

  const existing = new Set(content.split(/\r?\n/u))
  const added = runtimeExcludes.filter((entry) => !existing.has(entry))
  if (added.length === 0) return []

  await mkdir(dirname(path), { recursive: true })
  const prefix = content.length === 0 || content.endsWith('\n') ? content : `${content}\n`
  await writeFile(path, `${prefix}${added.join('\n')}\n`, 'utf8')
  return added
}

function isMissingFile(error: unknown): error is Error & { readonly code: unknown } {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
