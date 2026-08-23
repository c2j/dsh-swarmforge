export function buildSeedPrompt(role: string, toolNames: readonly string[]): string {
  const toolLines = toolNames.map((toolName) => `- \`${toolName}\``)
  return [
    'Read `swarmforge/constitution.prompt`, then read every file it refers to recursively, and obey all of those instructions.',
    `Read \`swarmforge/roles/${role}.prompt\`, then read every file it refers to recursively, and follow all of those instructions.`,
    '',
    '## Tool Startup',
    '',
    'Available tools:',
    ...toolLines,
    '',
    'Mandatory flow:',
    '- When you receive wake text, call `ready_for_next` before doing any work.',
    '- When you complete the current work, call `done_with_current`.',
    ...(toolNames.includes('swarm_handoff') ? ['- Use `swarm_handoff` to send work or notes to another role.'] : []),
    `- Every commit must include the byline \`By ${role}.\`.`,
  ].join('\n')
}
