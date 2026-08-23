import { describe, expect, it } from 'vitest'

import { validateDraft } from '../../src/protocol/index.js'

const roster = new Set(['architect', 'code-reviewer'])

describe('validateDraft', () => {
  it('shouldAcceptGitHandoffDraftAndDefaultPriorityTo50', () => {
    const result = validateDraft(
      { type: 'git_handoff', to: 'architect,code-reviewer', task: 'Implement parser' },
      roster,
    )

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'git_handoff',
        to: 'architect,code-reviewer',
        recipients: ['architect', 'code-reviewer'],
        priority: '50',
        task: 'Implement parser',
      },
    })
  })

  it('shouldAcceptNoteDraftWithMessage', () => {
    const result = validateDraft(
      { type: 'note', to: 'architect', priority: '00', message: 'Please review the protocol.' },
      roster,
    )

    expect(result.ok).toBe(true)
  })

  it('shouldRejectDraftWithUnknownField', () => {
    const result = validateDraft({ type: 'note', to: 'architect', message: 'hello', surprise: true }, roster)

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          field: 'surprise',
          problem: 'is not an allowed draft field',
          hint: 'Use only: type, to, priority, task, commit, message.',
        },
      ],
    })
  })

  it('shouldRejectDraftWithEveryReservedField', () => {
    const reserved = [
      'id', 'from', 'role', 'recipient', 'created_at', 'enqueued_at',
      'dequeued_at', 'completed_at', 'approved', 'artifacts',
    ]
    const draft = Object.fromEntries(reserved.map((field) => [field, 'forbidden']))

    const result = validateDraft({ type: 'note', to: 'architect', message: 'hello', ...draft }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map(({ field }) => field)).toEqual(reserved)
      expect(result.errors.every(({ problem, hint }) => problem.includes('reserved') && Boolean(hint))).toBe(true)
    }
  })

  it('shouldRejectDraftWithIllegalType', () => {
    const result = validateDraft({ type: 'request', to: 'architect' }, roster)

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: 'type', problem: 'must be a supported handoff type', hint: 'Use git_handoff or note.' },
      ]),
    })
  })

  it('shouldRejectEmptyRecipientList', () => {
    const result = validateDraft({ type: 'note', to: '  ', message: 'hello' }, roster)

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: 'to', problem: 'must contain at least one recipient', hint: 'Use a comma-separated list of known role names.' },
      ]),
    })
  })

  it('shouldRejectUnknownRecipient', () => {
    const result = validateDraft({ type: 'note', to: 'unknown', message: 'hello' }, roster)

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: 'to', problem: 'contains unknown role "unknown"', hint: 'Known roles: architect, code-reviewer.' },
      ]),
    })
  })

  it('shouldRejectRecipientContainingUnderscore', () => {
    const result = validateDraft({ type: 'note', to: 'code_reviewer', message: 'hello' }, new Set(['code_reviewer']))

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: 'to', problem: 'role "code_reviewer" contains an underscore', hint: 'Role names must not contain underscores; use kebab-case.' },
      ]),
    })
  })

  it('shouldRejectMalformedRecipientList', () => {
    const result = validateDraft({ type: 'note', to: 'architect,,code-reviewer', message: 'hello' }, roster)

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: 'to', problem: 'contains an empty recipient', hint: 'Use a comma-separated list such as architect,code-reviewer.' },
      ]),
    })
  })

  it.each(['0', '100', '5a', 50, ' 50'])('shouldRejectInvalidPriority %j', (priority) => {
    const result = validateDraft({ type: 'note', to: 'architect', message: 'hello', priority }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'priority',
        problem: 'must be a two-digit integer string from 00 through 99',
        hint: 'Use exactly two digits, for example 00, 50, or 99.',
      })
    }
  })

  it('shouldRequireTaskForGitHandoff', () => {
    const result = validateDraft({ type: 'git_handoff', to: 'architect' }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({
      field: 'task', problem: 'is required for git_handoff', hint: 'Provide a task name of at most 80 characters.',
    })
  })

  it('shouldRejectTaskLongerThan80Characters', () => {
    const result = validateDraft({ type: 'git_handoff', to: 'architect', task: 'x'.repeat(81) }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({
      field: 'task', problem: 'must be at most 80 characters', hint: 'Shorten task to 80 characters or fewer.',
    })
  })

  it('shouldAllowDraftWithoutCommit', () => {
    expect(validateDraft({ type: 'git_handoff', to: 'architect', task: 'Implement parser' }, roster).ok).toBe(true)
  })

  it.each(['abcdef123', 'abcdef12345', 'abcdefghi1', ' abcdef1234'])('shouldRejectInvalidCommit %j', (commit) => {
    const result = validateDraft({ type: 'git_handoff', to: 'architect', task: 'Task', commit }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({
      field: 'commit', problem: 'must be exactly 10 hexadecimal characters', hint: 'Use a 10-character commit prefix such as a1B2c3D4e5.',
    })
  })

  it('shouldAcceptUppercaseAndLowercaseHexCommit', () => {
    expect(validateDraft({ type: 'git_handoff', to: 'architect', task: 'Task', commit: 'a1B2c3D4e5' }, roster).ok).toBe(true)
  })

  it('shouldRequireMessageForNote', () => {
    const result = validateDraft({ type: 'note', to: 'architect' }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({
      field: 'message', problem: 'is required for note', hint: 'Provide a single-line message of at most 80 characters.',
    })
  })

  it('shouldRejectMultilineNoteMessage', () => {
    const result = validateDraft({ type: 'note', to: 'architect', message: 'line one\nline two' }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({
      field: 'message', problem: 'must be a single line', hint: 'Remove newline characters from the message.',
    })
  })

  it('shouldRejectNoteMessageLongerThan80Characters', () => {
    const result = validateDraft({ type: 'note', to: 'architect', message: 'x'.repeat(81) }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({
      field: 'message', problem: 'must be at most 80 characters', hint: 'Shorten message to 80 characters or fewer.',
    })
  })

  it('shouldReturnAllValidationErrorsAtOnce', () => {
    const result = validateDraft({ type: 'request', to: 'unknown', priority: '7' }, roster)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map(({ field }) => field)).toEqual(['type', 'to', 'priority'])
  })
})
