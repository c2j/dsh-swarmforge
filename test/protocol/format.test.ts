import { describe, expect, it } from 'vitest'

import { formatDeliveredHandoff, parseDeliveredHandoff, ProtocolParseError } from '../../src/protocol/index.js'

const gitHandoff = {
  id: '20260823T121314Z_000007_from_architect',
  from: 'architect',
  to: 'code-reviewer,coder',
  recipient: 'coder',
  priority: '05',
  type: 'git_handoff' as const,
  role: 'architect',
  task: 'Implement parser',
  commit: 'a1B2c3D4e5',
  artifacts: 'src/a.ts,test/a.test.ts',
  created_at: '2026-08-23T12:13:14.000Z',
  enqueued_at: '2026-08-23T12:14:00.000Z',
}

describe('delivered handoff format', () => {
  it('shouldFormatGitHandoffWithVerbatimBody', () => {
    expect(formatDeliveredHandoff(gitHandoff)).toBe([
      'id: 20260823T121314Z_000007_from_architect',
      'from: architect',
      'to: code-reviewer,coder',
      'recipient: coder',
      'priority: 05',
      'type: git_handoff',
      'role: architect',
      'task: Implement parser',
      'commit: a1B2c3D4e5',
      'artifacts: src/a.ts,test/a.test.ts',
      'created_at: 2026-08-23T12:13:14.000Z',
      'enqueued_at: 2026-08-23T12:14:00.000Z',
      '',
      'Re-read your role and constitution.',
      '',
      'merge_and_process architect a1B2c3D4e5',
    ].join('\n'))
  })

  it('shouldFormatNoteWithVerbatimMessageBody', () => {
    expect(formatDeliveredHandoff({
      id: '20260823T121314Z_000008_from_architect',
      from: 'architect',
      to: 'coder',
      priority: '50',
      type: 'note',
      role: 'architect',
      message: 'Please review this.',
      created_at: '2026-08-23T12:13:14.000Z',
    })).toContain('Re-read your role and constitution.\n\nPlease review this.')
  })

  it('shouldPlaceApprovedAtEndOfHeaderBlock', () => {
    const formatted = formatDeliveredHandoff({ ...gitHandoff, approved: true, completed_at: '2026-08-23T13:00:00.000Z' })

    expect(formatted).toContain('completed_at: 2026-08-23T13:00:00.000Z\napproved: true\n\nRe-read')
  })

  it('shouldParseHeadersInAnyOrderIntoTypedGitHandoff', () => {
    const content = [
      'type: git_handoff',
      'commit: a1B2c3D4e5',
      'task: Implement parser',
      'role: architect',
      'priority: 05',
      'to: code-reviewer,coder',
      'from: architect',
      'created_at: 2026-08-23T12:13:14.000Z',
      'id: 20260823T121314Z_000007_from_architect',
      '',
      'Re-read your role and constitution.',
      '',
      'merge_and_process architect a1B2c3D4e5',
    ].join('\n')

    expect(parseDeliveredHandoff(content)).toEqual({
      ok: true,
      value: {
        id: '20260823T121314Z_000007_from_architect',
        from: 'architect',
        to: 'code-reviewer,coder',
        priority: '05',
        type: 'git_handoff',
        role: 'architect',
        task: 'Implement parser',
        commit: 'a1B2c3D4e5',
        created_at: '2026-08-23T12:13:14.000Z',
      },
    })
  })

  it('shouldRoundTripNoteIncludingLifecycleHeaders', () => {
    const note = {
      id: '20260823T121314Z_000008_from_architect', from: 'architect', to: 'coder', recipient: 'coder',
      priority: '50', type: 'note' as const, role: 'architect', message: 'Please review this.',
      created_at: '2026-08-23T12:13:14.000Z', enqueued_at: '2026-08-23T12:14:00.000Z',
      dequeued_at: '2026-08-23T12:15:00.000Z', completed_at: '2026-08-23T12:16:00.000Z', approved: true as const,
    }

    expect(parseDeliveredHandoff(formatDeliveredHandoff(note))).toEqual({ ok: true, value: note })
  })

  it('shouldRejectUnknownHeaderAndListItsName', () => {
    const content = formatDeliveredHandoff(gitHandoff).replace('task: Implement parser', 'mystery: value\ntask: Implement parser')

    expect(parseDeliveredHandoff(content)).toEqual({
      ok: false,
      errors: [{ field: 'mystery', problem: 'is an unknown delivered-file header', hint: 'Allowed headers: id, from, to, recipient, priority, type, role, task, commit, artifacts, created_at, enqueued_at, dequeued_at, completed_at, approved, message.' }],
    })
  })

  it('shouldRejectMalformedHeaderLineDidactically', () => {
    const content = formatDeliveredHandoff(gitHandoff).replace('task: Implement parser', 'task Implement parser')
    const result = parseDeliveredHandoff(content)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toEqual({
      field: 'header', problem: 'line 8 is not a name: value header', hint: 'Use one header per line, for example task: Implement parser.',
    })
  })

  it('shouldRejectBodyThatDoesNotMatchHeaders', () => {
    const content = formatDeliveredHandoff(gitHandoff).replace('merge_and_process architect a1B2c3D4e5', 'merge_and_process coder a1B2c3D4e5')
    const result = parseDeliveredHandoff(content)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({
      field: 'body', problem: 'does not match the git_handoff headers', hint: 'Use exactly: Re-read your role and constitution. followed by merge_and_process <from> <commit>.',
    })
  })

  it('shouldThrowProtocolParseErrorWhenUsingOrThrowParser', () => {
    expect(() => parseDeliveredHandoff('unknown: value', { throwOnError: true })).toThrow(ProtocolParseError)
  })
})
