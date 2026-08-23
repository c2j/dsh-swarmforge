import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { NodeGitRunner, type GitRunner } from './runner.js'

export type CommitMsgHookErrorKind = 'foreign-hook' | 'git-error'

export class CommitMsgHookError extends Error {
  constructor(
    public readonly kind: CommitMsgHookErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'CommitMsgHookError'
  }
}

export interface InstallCommitMsgHookResult {
  readonly installed: boolean
  readonly hookPath: string
}

const defaultRunner = new NodeGitRunner()

export async function installCommitMsgHook(
  projectRoot: string,
  runner: GitRunner = defaultRunner,
): Promise<InstallCommitMsgHookResult> {
  const commonDirResult = await runner.run(projectRoot, 'rev-parse', '--git-common-dir')
  if (commonDirResult.code !== 0) throw gitError('Could not resolve git common directory', commonDirResult.stderr)

  const commonDir = commonDirResult.stdout.trim()
  const resolvedCommonDir = isAbsolute(commonDir) ? commonDir : resolve(projectRoot, commonDir)
  const hookPath = join(resolvedCommonDir, 'hooks', 'commit-msg')
  const existing = await readOptionalFile(hookPath)
  if (existing !== undefined) {
    if (existing === commitMsgHook) return { installed: false, hookPath }
    throw new CommitMsgHookError(
      'foreign-hook',
      `Refusing to replace existing commit-msg hook at ${hookPath}; inspect and reconcile it manually.`,
    )
  }

  await mkdir(dirname(hookPath), { recursive: true })
  await writeFile(hookPath, commitMsgHook, 'utf8')
  await chmod(hookPath, 0o755)
  return { installed: true, hookPath }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function gitError(summary: string, stderr: string): CommitMsgHookError {
  const detail = stderr.trim()
  return new CommitMsgHookError('git-error', detail.length > 0 ? `${summary}: ${detail}` : summary)
}

const commitMsgHook = `#!/bin/bash
message_file=$1
search_dir=$(pwd -P)
roster=

while [ "$search_dir" != / ]; do
  if [ -f "$search_dir/.swarmforge/roles.tsv" ]; then
    roster=$search_dir/.swarmforge/roles.tsv
    project_root=$search_dir
    break
  fi
  search_dir=$(dirname "$search_dir")
done

# Plan §4.6 deviation: fail open when this repository has no usable SwarmForge roster.
[ -n "$roster" ] || exit 0

checkout_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ "$checkout_root" = "$project_root" ]; then
  worktree=master
else
  worktree=$(basename "$checkout_root")
fi

role=$(awk -F '\t' -v worktree="$worktree" 'NR > 1 && $2 == worktree { print $1; exit }' "$roster")
[ -n "$role" ] || exit 0
grep -Eq '^By [^[:space:]].*\\.$' "$message_file" && exit 0
printf '\n\nBy %s.\n' "$role" >> "$message_file"
`
