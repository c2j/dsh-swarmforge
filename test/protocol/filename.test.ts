import { describe, expect, it } from 'vitest'

import { compareHandoffFilenames, createHandoffId, formatUtcTimestamp, generateHandoffFilename } from '../../src/protocol/index.js'

const now = new Date('2026-08-23T12:13:14.987Z')

describe('handoff filename and ordering', () => {
  it('shouldFormatTimestampAsCompactUtcSeconds', () => {
    expect(formatUtcTimestamp(now)).toBe('20260823T121314Z')
  })

  it('shouldGenerateFilenameFromPriorityTimestampSequenceSenderAndRecipients', () => {
    expect(generateHandoffFilename({
      priority: '05', now, sequence: 7, sender: 'architect', recipients: ['coder', 'code-reviewer'],
    })).toBe('05_20260823T121314Z_000007_from_architect_to_coder_code-reviewer.handoff')
  })

  it('shouldGenerateIdFromSameTimestampSequenceAndSender', () => {
    expect(createHandoffId({ now, sequence: 7, sender: 'architect' })).toBe('20260823T121314Z_000007_from_architect')
  })

  it('shouldRejectSequenceOutsideSixDigitRange', () => {
    expect(() => createHandoffId({ now, sequence: -1, sender: 'architect' })).toThrow('sequence must be an integer from 0 through 999999')
    expect(() => createHandoffId({ now, sequence: 1_000_000, sender: 'architect' })).toThrow('sequence must be an integer from 0 through 999999')
  })

  it('shouldRejectFilenameComponentsContainingUnderscores', () => {
    expect(() => generateHandoffFilename({ priority: '50', now, sequence: 1, sender: 'code_reviewer', recipients: ['coder'] })).toThrow('sender must not contain underscores')
    expect(() => generateHandoffFilename({ priority: '50', now, sequence: 1, sender: 'architect', recipients: ['code_reviewer'] })).toThrow('recipient must not contain underscores')
  })

  it('shouldKeepQueueOrderLexicographic', () => {
    const names = [
      '50_20260823T121314Z_000001_from_architect_to_coder.handoff',
      '05_20260823T121315Z_000002_from_architect_to_coder.handoff',
      '05_20260823T121314Z_000010_from_architect_to_coder.handoff',
      '05_20260823T121314Z_000002_from_architect_to_coder.handoff',
    ]

    expect(names.sort(compareHandoffFilenames)).toEqual([
      '05_20260823T121314Z_000002_from_architect_to_coder.handoff',
      '05_20260823T121314Z_000010_from_architect_to_coder.handoff',
      '05_20260823T121315Z_000002_from_architect_to_coder.handoff',
      '50_20260823T121314Z_000001_from_architect_to_coder.handoff',
    ])
  })
})
