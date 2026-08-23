import { execFile } from 'node:child_process'

export interface GitRunResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

export interface GitRunner {
  run(cwd: string, ...args: string[]): Promise<GitRunResult>
}

export class NodeGitRunner implements GitRunner {
  async run(cwd: string, ...args: string[]): Promise<GitRunResult> {
    return new Promise((resolve) => {
      execFile(
        'git',
        args,
        {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout,
            stderr,
            code: typeof error?.code === 'number' ? error.code : error === null ? 0 : 1,
          })
        },
      )
    })
  }
}
