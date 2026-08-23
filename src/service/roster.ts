export type ReceiveMode = 'task' | 'batch'

export interface RoleDef {
  readonly name: string
  readonly worktree: string
  readonly mode: ReceiveMode
  readonly model?: string
  readonly provider?: string
  readonly cwd: string
}

export interface Roster {
  readonly roles: readonly RoleDef[]
  readonly byRole: ReadonlyMap<string, RoleDef>
}

export type ResolveCwd = (role: Omit<RoleDef, 'cwd'>, projectRoot: string) => string

export class RosterValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'RosterValidationError'
  }
}

const roleNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const allowedFields = new Set(['worktree', 'mode', 'model', 'provider'])

export function parseRoster(
  content: string,
  projectRoot: string,
  resolveCwd: ResolveCwd = (_role, root) => root,
): Roster {
  const problems: string[] = []
  const parsed: Array<Omit<RoleDef, 'cwd'>> = []

  for (const [lineIndex, original] of content.split(/\r?\n/u).entries()) {
    const line = original.replace(/#.*$/u, '').trim()
    if (line.length === 0) continue
    const tokens = line.split(/\s+/u)
    if (tokens[0] !== 'role') {
      problems.push(`line ${lineIndex + 1}: must start with role`)
      continue
    }
    const name = tokens[1] ?? ''
    if (!roleNamePattern.test(name)) {
      problems.push(`line ${lineIndex + 1}: role "${name}" must be kebab-case using lowercase letters, digits, and hyphens`)
    }

    const fields: Record<string, string> = {}
    for (const token of tokens.slice(2)) {
      const separator = token.indexOf('=')
      const key = separator < 0 ? token : token.slice(0, separator)
      const value = separator < 0 ? '' : token.slice(separator + 1)
      if (!allowedFields.has(key)) {
        problems.push(`line ${lineIndex + 1}: unknown field "${key}"; use worktree, mode, model, or provider`)
      } else if (fields[key] !== undefined) {
        problems.push(`line ${lineIndex + 1}: field "${key}" appears more than once`)
      } else {
        fields[key] = value
      }
    }

    const mode = fields.mode ?? 'task'
    if (mode !== 'task' && mode !== 'batch') {
      problems.push(`line ${lineIndex + 1}: mode must be task or batch`)
    }
    const worktree = fields.worktree ?? name
    for (const key of ['model', 'provider'] as const) {
      if (fields[key] === '') problems.push(`line ${lineIndex + 1}: ${key} must be a non-empty identifier`)
    }
    parsed.push({
      name,
      worktree,
      mode: mode === 'batch' ? 'batch' : 'task',
      ...(fields.model === undefined || fields.model === '' ? {} : { model: fields.model }),
      ...(fields.provider === undefined || fields.provider === '' ? {} : { provider: fields.provider }),
    })
  }

  reportDuplicates(parsed.map(({ name }) => name), 'role', problems)
  reportDuplicates(
    parsed.map(({ worktree }) => worktree).filter((worktree) => worktree !== 'master' && worktree !== 'none'),
    'worktree',
    problems,
  )
  const masters = parsed.filter(({ worktree }) => worktree === 'master').length
  if (masters !== 1) problems.push(`roster must define exactly one role with worktree=master; found ${masters}`)
  if (problems.length > 0) throw new RosterValidationError(problems)

  const roles = parsed.map((role): RoleDef => ({ ...role, cwd: resolveCwd(role, projectRoot) }))
  return { roles, byRole: new Map(roles.map((role) => [role.name, role])) }
}

function reportDuplicates(values: readonly string[], label: string, problems: string[]): void {
  const seen = new Set<string>()
  const reported = new Set<string>()
  for (const value of values) {
    if (seen.has(value) && !reported.has(value)) {
      problems.push(`duplicate ${label} "${value}"`)
      reported.add(value)
    }
    seen.add(value)
  }
}
