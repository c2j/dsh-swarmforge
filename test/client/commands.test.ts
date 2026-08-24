import { describe, expect, it } from 'vitest'

import { answerCommandLine, approveCommandLine, artifactCount, moveTaskCommandLine, newTaskCommandLine, rejectCommandLine, viewFromToggle } from '../../src/client/commands.js'

describe('approveCommandLine', () => {
  it('shouldBuildASwarmApproveCommandLine', () => {
    expect(approveCommandLine('ho-1')).toBe('/swarm approve ho-1')
  })
})

describe('rejectCommandLine', () => {
  it('shouldBuildASwarmRejectCommandLine', () => {
    expect(rejectCommandLine('ho-1')).toBe('/swarm reject ho-1')
  })
})

describe('answerCommandLine', () => {
  it('shouldBuildASwarmAnswerCommandLineWithTheFullText', () => {
    expect(answerCommandLine('clar-1', 'Use the v2 parser API')).toBe('/swarm answer clar-1 Use the v2 parser API')
  })
})

describe('artifactCount', () => {
  it('shouldCountZeroForAnEmptyArtifactsString', () => {
    expect(artifactCount('')).toBe(0)
  })

  it('shouldCountZeroForAWhitespaceOnlyArtifactsString', () => {
    expect(artifactCount('   ')).toBe(0)
  })

  it('shouldCountOneForASingleArtifact', () => {
    expect(artifactCount('src/a.ts')).toBe(1)
  })

  it('shouldCountEachCommaSeparatedArtifact', () => {
    expect(artifactCount('src/a.ts,src/b.ts,src/c.ts')).toBe(3)
  })
})

describe('board command lines', () => {
  it('shouldBuildANewTaskCommandWithFullText', () => {
    expect(newTaskCommandLine('build-parser', 'Build the parser now')).toBe('/swarm new build-parser Build the parser now')
  })

  it('shouldBuildAMoveTaskCommand', () => {
    expect(moveTaskCommandLine('build-parser', 'coder')).toBe('/swarm move build-parser coder')
  })
})

describe('viewFromToggle', () => {
  it.each([['queue', 'queue'], ['board', 'board'], ['boxes', 'boxes']] as const)('shouldMap %s ToItsView', (toggle, expected) => {
    expect(viewFromToggle(toggle)).toBe(expected)
  })
})
