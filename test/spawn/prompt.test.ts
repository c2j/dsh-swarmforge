import { describe, expect, it } from 'vitest'

import { buildSeedPrompt } from '../../src/spawn/prompt.js'

describe('buildSeedPrompt', () => {
  it('shouldInjectRecursiveInstructionsAndMandatoryToolFlow', () => {
    expect(buildSeedPrompt('coder', ['swarm_handoff', 'ready_for_next', 'done_with_current'])).toBe([
      'Read `swarmforge/constitution.prompt`, then read every file it refers to recursively, and obey all of those instructions.',
      'Read `swarmforge/roles/coder.prompt`, then read every file it refers to recursively, and follow all of those instructions.',
      '',
      '## Tool Startup',
      '',
      'Available tools:',
      '- `swarm_handoff`',
      '- `ready_for_next`',
      '- `done_with_current`',
      '',
      'Mandatory flow:',
      '- When you receive wake text, call `ready_for_next` before doing any work.',
      '- When you complete the current work, call `done_with_current`.',
      '- Use `swarm_handoff` to send work or notes to another role.',
      '- Every commit must include the byline `By coder.`.',
    ].join('\n'))
  })

  it('shouldListOnlyToolsAvailableToTheRole', () => {
    const prompt = buildSeedPrompt('architect', ['ready_for_next', 'done_with_current'])

    expect(prompt).toContain('- `ready_for_next`\n- `done_with_current`')
    expect(prompt).not.toContain('`swarm_handoff`')
    expect(prompt).toContain('Every commit must include the byline `By architect.`.')
  })
})
