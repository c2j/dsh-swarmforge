export const HANDOFF_TYPES = ['git_handoff', 'note'] as const

export type HandoffType = (typeof HANDOFF_TYPES)[number]

export interface DraftValidationError {
  readonly field: string
  readonly problem: string
  readonly hint?: string
}

export interface ValidatedDraft {
  readonly type: HandoffType
  readonly to: string
  readonly recipients: readonly string[]
  readonly priority: string
  readonly task?: string
  readonly commit?: string
  readonly message?: string
}

export type DraftValidationResult =
  | { readonly ok: true; readonly value: ValidatedDraft }
  | { readonly ok: false; readonly errors: readonly DraftValidationError[] }

const ALLOWED_FIELDS = new Set(['type', 'to', 'priority', 'task', 'commit', 'message'])
const RESERVED_FIELDS = new Set([
  'id', 'from', 'role', 'recipient', 'created_at', 'enqueued_at',
  'dequeued_at', 'completed_at', 'approved', 'artifacts',
])

export function validateDraft(draft: Readonly<Record<string, unknown>>, roster: ReadonlySet<string>): DraftValidationResult {
  const errors: DraftValidationError[] = []

  for (const field of Object.keys(draft)) {
    if (RESERVED_FIELDS.has(field)) {
      errors.push({
        field,
        problem: 'is reserved and cannot be set in a draft',
        hint: 'Remove it; the protocol lifecycle sets reserved fields.',
      })
    } else if (!ALLOWED_FIELDS.has(field)) {
      errors.push({
        field,
        problem: 'is not an allowed draft field',
        hint: 'Use only: type, to, priority, task, commit, message.',
      })
    }
  }

  const type = draft.type
  if (type !== 'git_handoff' && type !== 'note') {
    errors.push({ field: 'type', problem: 'must be a supported handoff type', hint: 'Use git_handoff or note.' })
  }

  const recipients = validateRecipients(draft.to, roster, errors)
  const priority = draft.priority === undefined ? '50' : draft.priority
  if (typeof priority !== 'string' || !/^\d{2}$/.test(priority)) {
    errors.push({
      field: 'priority',
      problem: 'must be a two-digit integer string from 00 through 99',
      hint: 'Use exactly two digits, for example 00, 50, or 99.',
    })
  }

  const task = validateOptionalString(draft.task, 'task', errors)
  if (type === 'git_handoff' && (task === undefined || task.length === 0)) {
    errors.push({ field: 'task', problem: 'is required for git_handoff', hint: 'Provide a task name of at most 80 characters.' })
  } else if (task !== undefined && task.length > 80) {
    errors.push({ field: 'task', problem: 'must be at most 80 characters', hint: 'Shorten task to 80 characters or fewer.' })
  }

  const commit = validateOptionalString(draft.commit, 'commit', errors)
  if (commit !== undefined && !/^[0-9a-fA-F]{10}$/.test(commit)) {
    errors.push({
      field: 'commit',
      problem: 'must be exactly 10 hexadecimal characters',
      hint: 'Use a 10-character commit prefix such as a1B2c3D4e5.',
    })
  }

  const message = validateOptionalString(draft.message, 'message', errors)
  if (type === 'note' && (message === undefined || message.length === 0)) {
    errors.push({ field: 'message', problem: 'is required for note', hint: 'Provide a single-line message of at most 80 characters.' })
  } else if (message !== undefined && /[\r\n]/.test(message)) {
    errors.push({ field: 'message', problem: 'must be a single line', hint: 'Remove newline characters from the message.' })
  } else if (message !== undefined && message.length > 80) {
    errors.push({ field: 'message', problem: 'must be at most 80 characters', hint: 'Shorten message to 80 characters or fewer.' })
  }

  if (errors.length > 0 || (type !== 'git_handoff' && type !== 'note') || typeof priority !== 'string') {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      type,
      to: recipients.join(','),
      recipients,
      priority,
      ...(task === undefined ? {} : { task }),
      ...(commit === undefined ? {} : { commit }),
      ...(message === undefined ? {} : { message }),
    },
  }
}

function validateRecipients(
  value: unknown,
  roster: ReadonlySet<string>,
  errors: DraftValidationError[],
): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({ field: 'to', problem: 'must contain at least one recipient', hint: 'Use a comma-separated list of known role names.' })
    return []
  }

  const recipients = value.split(',').map((recipient) => recipient.trim())
  if (recipients.some((recipient) => recipient.length === 0)) {
    errors.push({ field: 'to', problem: 'contains an empty recipient', hint: 'Use a comma-separated list such as architect,code-reviewer.' })
    return recipients
  }

  for (const recipient of recipients) {
    if (recipient.includes('_')) {
      errors.push({
        field: 'to',
        problem: `role "${recipient}" contains an underscore`,
        hint: 'Role names must not contain underscores; use kebab-case.',
      })
    } else if (!roster.has(recipient)) {
      errors.push({
        field: 'to',
        problem: `contains unknown role "${recipient}"`,
        hint: `Known roles: ${[...roster].join(', ')}.`,
      })
    }
  }
  return recipients
}

function validateOptionalString(
  value: unknown,
  field: string,
  errors: DraftValidationError[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  errors.push({ field, problem: 'must be a string', hint: `Provide ${field} as text.` })
  return undefined
}
