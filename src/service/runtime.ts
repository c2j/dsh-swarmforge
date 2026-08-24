import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { HANDOFF_PATHS } from '../protocol/index.js'
import type { Roster } from './roster.js'

const ownerPaths = [
  HANDOFF_PATHS.ownerOutboxTmp,
  HANDOFF_PATHS.ownerOutboxSent,
  HANDOFF_PATHS.ownerOutboxFailed,
  HANDOFF_PATHS.inboxNew,
  HANDOFF_PATHS.inboxInProcess,
  HANDOFF_PATHS.inboxCompleted,
] as const

export async function ensureRuntimeState(projectRoot: string, roster: Roster): Promise<void> {
  const handoffsRoot = join(projectRoot, '.swarmforge', 'handoffs')
  const directories = roster.roles.flatMap((role) => ownerPaths.map((path) => join(handoffsRoot, role.name, path)))
  directories.push(join(handoffsRoot, HANDOFF_PATHS.pendingApproval), join(handoffsRoot, HANDOFF_PATHS.projectOutbox))
  directories.push(join(projectRoot, '.swarmforge', 'notify'))
  directories.push(join(projectRoot, '.swarmforge', 'dashboard', 'clarifications', 'pending'))
  directories.push(join(projectRoot, '.swarmforge', 'dashboard', 'clarifications', 'answered'))
  directories.push(join(projectRoot, '.swarmforge', 'board'))
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })))

  const rows = roster.roles.map((role) => `${role.name}\t${role.worktree}\t${role.mode}`)
  await writeFile(join(projectRoot, '.swarmforge', 'roles.tsv'), `role\tworktree\treceive-mode\n${rows.join('\n')}\n`, 'utf8')
  const tasksPath = join(projectRoot, '.swarmforge', 'board', 'tasks.tsv')
  try {
    await readFile(tasksPath, 'utf8')
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    await writeFile(tasksPath, '', 'utf8')
  }
}

export async function readAnchorIds(projectRoot: string): Promise<Map<string, string>> {
  try {
    const content = await readFile(join(projectRoot, '.swarmforge', 'anchors.tsv'), 'utf8')
    return new Map(content.split(/\r?\n/u).slice(1).filter(Boolean).map((row) => {
      const [role, anchorId] = row.split('\t')
      if (role === undefined || anchorId === undefined) throw new Error(`Invalid anchors.tsv row: ${row}`)
      return [role, anchorId]
    }))
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Map()
    throw error
  }
}

export async function writeAnchorIds(projectRoot: string, anchors: ReadonlyMap<string, string>): Promise<void> {
  await mkdir(join(projectRoot, '.swarmforge'), { recursive: true })
  const rows = [...anchors].map(([role, anchorId]) => `${role}\t${anchorId}`)
  await writeFile(join(projectRoot, '.swarmforge', 'anchors.tsv'), `role\tanchor-session\n${rows.join('\n')}\n`, 'utf8')
}
