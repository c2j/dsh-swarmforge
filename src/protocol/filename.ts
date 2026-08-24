export interface HandoffIdentityInput {
  readonly now: Date
  readonly sequence: number
  readonly sender: string
}

export interface HandoffFilenameInput extends HandoffIdentityInput {
  readonly priority: string
  readonly recipients: readonly string[]
}

export function formatUtcTimestamp(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('now must be a valid Date')
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function createHandoffId(input: HandoffIdentityInput): string {
  validateSequence(input.sequence)
  validateRoleComponent(input.sender, 'sender')
  return `${formatUtcTimestamp(input.now)}_${formatSequence(input.sequence)}_from_${input.sender}`
}

export function generateHandoffFilename(input: HandoffFilenameInput): string {
  if (!/^\d{2}$/.test(input.priority)) throw new Error('priority must be a two-digit string from 00 through 99')
  if (input.recipients.length === 0) throw new Error('recipients must contain at least one role')
  for (const recipient of input.recipients) validateRoleComponent(recipient, 'recipient')
  return `${input.priority}_${createHandoffId(input)}_to_${input.recipients.join('_')}.handoff`
}

export function compareHandoffFilenames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function formatSequence(sequence: number): string {
  return sequence.toString().padStart(6, '0')
}

function validateSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999_999) {
    throw new Error('sequence must be an integer from 0 through 999999')
  }
}

function validateRoleComponent(role: string, label: 'sender' | 'recipient'): void {
  if (role.includes('_')) throw new Error(`${label} must not contain underscores`)
  if (role.length === 0) throw new Error(`${label} must not be empty`)
}
