export function approveCommandLine(id: string): string {
  return `/swarm approve ${id}`
}

export function rejectCommandLine(id: string): string {
  return `/swarm reject ${id}`
}

export function answerCommandLine(id: string, answer: string): string {
  return `/swarm answer ${id} ${answer}`
}

export function newTaskCommandLine(name: string, text: string): string {
  return `/swarm new ${name} ${text}`
}

export function moveTaskCommandLine(name: string, lane: string): string {
  return `/swarm move ${name} ${lane}`
}

export type SwarmView = 'queue' | 'board' | 'boxes'

export function viewFromToggle(toggle: SwarmView): SwarmView {
  return toggle
}

export function artifactCount(artifacts: string): number {
  const trimmed = artifacts.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(',').length
}
