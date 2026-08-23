import type { DraftValidationError, HandoffType } from './validate.js'

export const DELIVERED_HEADER_ORDER = [
  'id', 'from', 'to', 'recipient', 'priority', 'type', 'role', 'task', 'commit', 'artifacts',
  'created_at', 'enqueued_at', 'dequeued_at', 'completed_at', 'approved',
] as const

export type DeliveredHeader = (typeof DELIVERED_HEADER_ORDER)[number]

interface CommonHandoff {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly recipient?: string
  readonly priority: string
  readonly role: string
  readonly task?: string
  readonly artifacts?: string
  readonly created_at: string
  readonly enqueued_at?: string
  readonly dequeued_at?: string
  readonly completed_at?: string
  readonly approved?: true
}

export interface DeliveredGitHandoff extends CommonHandoff {
  readonly type: 'git_handoff'
  readonly task: string
  readonly commit: string
}

export interface DeliveredNote extends CommonHandoff {
  readonly type: 'note'
  readonly message: string
  readonly commit?: never
}

export type DeliveredHandoff = DeliveredGitHandoff | DeliveredNote
export type ParseDeliveredResult =
  | { readonly ok: true; readonly value: DeliveredHandoff }
  | { readonly ok: false; readonly errors: readonly DraftValidationError[] }

const PREAMBLE = 'Re-read your role and constitution.'
const KNOWN_HEADERS = new Set<string>([...DELIVERED_HEADER_ORDER, 'message'])
const REQUIRED_COMMON_HEADERS = ['id', 'from', 'to', 'priority', 'type', 'role', 'created_at'] as const

export class ProtocolParseError extends Error {
  constructor(readonly errors: readonly DraftValidationError[]) {
    super(errors.map(({ field, problem }) => `${field}: ${problem}`).join('; '))
    this.name = 'ProtocolParseError'
  }
}

export function formatDeliveredHandoff(handoff: DeliveredHandoff): string {
  const values: Readonly<Record<DeliveredHeader, string | undefined>> = {
    id: handoff.id,
    from: handoff.from,
    to: handoff.to,
    recipient: handoff.recipient,
    priority: handoff.priority,
    type: handoff.type,
    role: handoff.role,
    task: handoff.task,
    commit: handoff.type === 'git_handoff' ? handoff.commit : undefined,
    artifacts: handoff.artifacts,
    created_at: handoff.created_at,
    enqueued_at: handoff.enqueued_at,
    dequeued_at: handoff.dequeued_at,
    completed_at: handoff.completed_at,
    approved: handoff.approved === true ? 'true' : undefined,
  }
  const headers = DELIVERED_HEADER_ORDER.flatMap((header) => {
    const value = values[header]
    return value === undefined ? [] : [`${header}: ${value}`]
  })
  const instruction = handoff.type === 'git_handoff'
    ? `merge_and_process ${handoff.from} ${handoff.commit}`
    : handoff.message
  return [...headers, '', PREAMBLE, '', instruction].join('\n')
}

export function parseDeliveredHandoff(content: string, options?: { readonly throwOnError?: boolean }): ParseDeliveredResult {
  const result = parse(content)
  if (!result.ok && options?.throwOnError === true) throw new ProtocolParseError(result.errors)
  return result
}

function parse(content: string): ParseDeliveredResult {
  const separator = content.indexOf('\n\n')
  const errors: DraftValidationError[] = []
  if (separator < 0) {
    return failure([{ field: 'body', problem: 'is not separated from headers by a blank line', hint: 'Add one blank line after the header block.' }])
  }

  const headerLines = content.slice(0, separator).split('\n')
  const headers: Record<string, string> = {}
  for (const [index, line] of headerLines.entries()) {
    const match = /^([^:]+): (.*)$/.exec(line)
    if (match === null) {
      errors.push({ field: 'header', problem: `line ${index + 1} is not a name: value header`, hint: 'Use one header per line, for example task: Implement parser.' })
      continue
    }
    const name = match[1]
    const value = match[2]
    if (name === undefined || value === undefined) continue
    if (!KNOWN_HEADERS.has(name)) {
      errors.push({
        field: name,
        problem: 'is an unknown delivered-file header',
        hint: 'Allowed headers: id, from, to, recipient, priority, type, role, task, commit, artifacts, created_at, enqueued_at, dequeued_at, completed_at, approved, message.',
      })
    } else if (headers[name] !== undefined) {
      errors.push({ field: name, problem: 'appears more than once', hint: 'Include each delivered-file header at most once.' })
    } else {
      headers[name] = value
    }
  }

  for (const field of REQUIRED_COMMON_HEADERS) {
    if (!headers[field]) errors.push({ field, problem: 'is required in a delivered file', hint: `Add a ${field}: value header.` })
  }
  if (headers.approved !== undefined && headers.approved !== 'true') {
    errors.push({ field: 'approved', problem: 'must be true when present', hint: 'Use approved: true or omit the header.' })
  }

  const type = headers.type
  if (type !== 'git_handoff' && type !== 'note') {
    errors.push({ field: 'type', problem: 'must be a supported handoff type', hint: 'Use git_handoff or note.' })
  }
  const body = content.slice(separator + 2)
  if (type === 'git_handoff') validateGitBody(headers, body, errors)
  if (type === 'note' && !body.startsWith(`${PREAMBLE}\n\n`) ) {
    errors.push({ field: 'body', problem: 'does not match the note format', hint: `Start the body with ${PREAMBLE}` })
  }
  if (errors.length > 0) return failure(errors)

  const common = buildCommon(headers)
  if (common === undefined || (type !== 'git_handoff' && type !== 'note')) {
    return failure([{ field: 'headers', problem: 'could not construct delivered record', hint: 'Provide every required header.' }])
  }
  if (type === 'git_handoff') {
    const task = headers.task
    const commit = headers.commit
    if (task === undefined || commit === undefined) return failure([])
    return { ok: true, value: { ...common, type, task, commit } }
  }
  return { ok: true, value: { ...common, type, message: body.slice(`${PREAMBLE}\n\n`.length) } }
}

function validateGitBody(headers: Readonly<Record<string, string>>, body: string, errors: DraftValidationError[]): void {
  if (!headers.task) errors.push({ field: 'task', problem: 'is required for git_handoff', hint: 'Add a task header.' })
  if (!headers.commit || !/^[0-9a-fA-F]{10}$/.test(headers.commit)) {
    errors.push({ field: 'commit', problem: 'must be exactly 10 hexadecimal characters', hint: 'Add a 10-character commit prefix.' })
  }
  const expected = `${PREAMBLE}\n\nmerge_and_process ${headers.from ?? ''} ${headers.commit ?? ''}`
  if (body !== expected) {
    errors.push({
      field: 'body',
      problem: 'does not match the git_handoff headers',
      hint: 'Use exactly: Re-read your role and constitution. followed by merge_and_process <from> <commit>.',
    })
  }
}

function buildCommon(headers: Readonly<Record<string, string>>): Omit<CommonHandoff, never> | undefined {
  const id = headers.id
  const from = headers.from
  const to = headers.to
  const priority = headers.priority
  const role = headers.role
  const created_at = headers.created_at
  if (id === undefined || from === undefined || to === undefined || priority === undefined || role === undefined || created_at === undefined) return undefined
  return {
    id, from, to, priority, role, created_at,
    ...(headers.recipient === undefined ? {} : { recipient: headers.recipient }),
    ...(headers.task === undefined ? {} : { task: headers.task }),
    ...(headers.artifacts === undefined ? {} : { artifacts: headers.artifacts }),
    ...(headers.enqueued_at === undefined ? {} : { enqueued_at: headers.enqueued_at }),
    ...(headers.dequeued_at === undefined ? {} : { dequeued_at: headers.dequeued_at }),
    ...(headers.completed_at === undefined ? {} : { completed_at: headers.completed_at }),
    ...(headers.approved === undefined ? {} : { approved: true as const }),
  }
}

function failure(errors: readonly DraftValidationError[]): ParseDeliveredResult {
  return { ok: false, errors }
}

export type { HandoffType }
