import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createHandoffId,
  formatDeliveredHandoff,
  formatUtcTimestamp,
  generateHandoffFilename,
  HANDOFF_PATHS,
  compareHandoffFilenames,
  parseDeliveredHandoff,
  stampCompletion,
  stampApproval,
  stampDequeue,
  stampDelivery,
  validateDraft,
  type DeliveredHandoff,
  type SenderRecord,
  type ValidatedDraft,
} from '../protocol/index.js'
import type { MergeResult } from '../git/operations.js'
import type { Roster } from './roster.js'

export const WAKE_TEXT = 'You have new handoff mail. If idle, run ready_for_next.'

export interface GitOperations {
  worktreeHead(cwd: string): Promise<string>
  validateCommit(cwd: string, commit: string): Promise<string>
  commitReachableFromHead(cwd: string, commit: string): Promise<boolean>
  changedFiles(cwd: string, commit: string): Promise<string[]>
  mergeInto(cwd: string, senderRole: string, commit: string): Promise<MergeResult>
}

export interface SwarmForgeServiceOptions {
  readonly projectRoot: string
  readonly roster: Roster
  readonly gitOps: GitOperations
  readonly wake: (role: string, text: string) => Promise<void> | void
  readonly now: () => Date
}

export type ServiceErrorKind =
  | 'invalid-draft'
  | 'unknown-role'
  | 'commit-not-reachable'
  | 'delivery-failed'
  | 'ambiguous-in-process'
  | 'invalid-handoff'
  | 'merge-conflict'
  | 'no-current-task'
  | 'approval-not-found'
  | 'clarification-not-found'
  | 'invalid-clarification'
  | 'invalid-task'
  | 'task-exists'
  | 'task-not-found'

export class ServiceError extends Error {
  constructor(
    public readonly kind: ServiceErrorKind,
    message: string,
    public readonly details: readonly unknown[] = [],
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export interface SendResult {
  readonly id: string
  readonly file: string
}

export interface PendingApproval {
  readonly id: string
  readonly task: string
  readonly from: string
  readonly to: string
  readonly artifacts: string
  readonly file: string
}

export interface Clarification {
  readonly id: string
  readonly role: string
  readonly question: string
  readonly file: string
}

export interface BoardTask {
  readonly name: string
  readonly lane: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface InboxSummary {
  readonly role: string
  readonly counts: { readonly new: number; readonly inProcess: number; readonly completed: number }
  readonly pending: string[]
}

export interface OutboxSummary {
  readonly role: string
  readonly counts: { readonly tmp: number; readonly sent: number; readonly failed: number }
  readonly pending: string[]
}

interface TaskDetails {
  readonly from: string
  readonly type: 'git_handoff' | 'note'
  readonly priority: string
  readonly taskName?: string
  readonly payload: string
  readonly file: string
}

export interface BatchItem {
  readonly from: string
  readonly type: 'git_handoff' | 'note'
  readonly taskName: string | undefined
  readonly payload: string
}

export type ReadyResult =
  | ({ readonly status: 'TASK' } & TaskDetails)
  | ({ readonly status: 'RESUME' } & TaskDetails)
  | { readonly status: 'BATCH'; readonly items: BatchItem[] }
  | { readonly status: 'NO_TASK' }

export class SwarmForgeService {
  private readonly sequences = new Map<string, number>()
  private readonly senderLocks = new Map<string, Promise<void>>()

  constructor(private readonly options: SwarmForgeServiceOptions) {}

  async createTask(name: string, laneRole: string, text: string): Promise<BoardTask> {
    validateTaskName(name)
    this.requireRole(laneRole)
    const tasks = await this.listTasks()
    if (tasks.some((task) => task.name === name)) throw new ServiceError('task-exists', `Task "${name}" already exists.`)
    const timestamp = this.options.now().toISOString()
    const task = { name, lane: laneRole, createdAt: timestamp, updatedAt: timestamp }
    await writeFile(this.taskBodyPath(name), text, 'utf8')
    await this.writeTasks([...tasks, task])
    const sequence = this.nextSequence('(New Task)')
    const now = this.options.now()
    const id = createHandoffId({ now, sequence, sender: '(New Task)' })
    const file = generateHandoffFilename({ now, sequence, sender: '(New Task)', priority: '50', recipients: [laneRole] })
    const record: DeliveredHandoff = {
      id, from: '(New Task)', to: laneRole, priority: '50', type: 'note', role: '(New Task)', task: name,
      created_at: now.toISOString(), message: text,
    }
    await writeFile(join(this.handoffsPath(HANDOFF_PATHS.projectOutbox), file), formatDeliveredHandoff(record), 'utf8')
    await this.processRootOutbox()
    return task
  }

  async listTasks(): Promise<readonly BoardTask[]> {
    let content: string
    try {
      content = await readFile(this.tasksPath(), 'utf8')
    } catch (error: unknown) {
      if (isNotFound(error)) return []
      throw error
    }
    return content.split(/\r?\n/u).filter(Boolean).map((row) => {
      const [name, lane, createdAt, updatedAt, extra] = row.split('\t')
      if (name === undefined || lane === undefined || createdAt === undefined || updatedAt === undefined || extra !== undefined) {
        throw new ServiceError('invalid-task', `Invalid tasks.tsv row: ${row}`)
      }
      return { name, lane, createdAt, updatedAt }
    })
  }

  async getTaskBody(name: string): Promise<string> {
    validateTaskName(name)
    try {
      return await readFile(this.taskBodyPath(name), 'utf8')
    } catch (error: unknown) {
      if (isNotFound(error)) throw new ServiceError('task-not-found', `Task "${name}" was not found.`)
      throw error
    }
  }

  async moveTask(name: string, newLane: string): Promise<BoardTask> {
    validateTaskName(name)
    this.requireRole(newLane)
    const tasks = await this.listTasks()
    const current = tasks.find((task) => task.name === name)
    if (current === undefined) throw new ServiceError('task-not-found', `Task "${name}" was not found.`)
    const moved = { ...current, lane: newLane, updatedAt: this.options.now().toISOString() }
    await this.writeTasks(tasks.map((task) => task.name === name ? moved : task))
    return moved
  }

  async deleteTask(name: string): Promise<void> {
    validateTaskName(name)
    const tasks = await this.listTasks()
    if (!tasks.some((task) => task.name === name)) throw new ServiceError('task-not-found', `Task "${name}" was not found.`)
    await this.writeTasks(tasks.filter((task) => task.name !== name))
    await unlink(this.taskBodyPath(name)).catch((error: unknown) => { if (!isNotFound(error)) throw error })
  }

  async getInboxSummary(roleName: string): Promise<InboxSummary> {
    this.requireRole(roleName)
    const [fresh, inProcess, completed] = await Promise.all([
      this.sortedFiles(roleName, HANDOFF_PATHS.inboxNew),
      this.sortedFiles(roleName, HANDOFF_PATHS.inboxInProcess),
      this.sortedFiles(roleName, HANDOFF_PATHS.inboxCompleted),
    ])
    return { role: roleName, counts: { new: fresh.length, inProcess: inProcess.length, completed: completed.length }, pending: [...fresh, ...inProcess] }
  }

  async getOutboxSummary(roleName: string): Promise<OutboxSummary> {
    this.requireRole(roleName)
    const [tmp, sent, failed] = await Promise.all([
      this.sortedFiles(roleName, HANDOFF_PATHS.ownerOutboxTmp),
      this.sortedFiles(roleName, HANDOFF_PATHS.ownerOutboxSent),
      this.sortedFiles(roleName, HANDOFF_PATHS.ownerOutboxFailed),
    ])
    return { role: roleName, counts: { tmp: tmp.length, sent: sent.length, failed: failed.length }, pending: [...tmp, ...failed] }
  }

  async sendHandoff(senderRole: string, draft: Readonly<Record<string, unknown>>): Promise<SendResult> {
    return this.withSenderLock(senderRole, () => this.sendLocked(senderRole, draft))
  }

  async listPendingApprovals(): Promise<readonly PendingApproval[]> {
    const directory = this.handoffsPath(HANDOFF_PATHS.pendingApproval)
    const files = (await readdir(directory)).sort(compareHandoffFilenames)
    return Promise.all(files.map(async (file) => {
      const record = await this.readDelivered(join(directory, file))
      if (record.type !== 'git_handoff') throw new ServiceError('invalid-handoff', `Pending approval ${file} is not a git handoff.`)
      return {
        id: record.id,
        task: record.task,
        from: record.from,
        to: record.to,
        artifacts: record.artifacts ?? '',
        file,
      }
    }))
  }

  async approve(id: string): Promise<{ readonly id: string; readonly file: string }> {
    const pending = await this.findPendingApproval(id)
    const record = await this.readDelivered(pending.path)
    const approved = stampApproval(record as SenderRecord) as DeliveredHandoff
    const staging = `${pending.path}.tmp`
    await writeFile(staging, formatDeliveredHandoff(approved), 'utf8')
    await rename(staging, pending.path)
    await rename(pending.path, join(this.handoffsPath(HANDOFF_PATHS.projectOutbox), pending.file))
    await this.processRootOutbox()
    return { id, file: pending.file }
  }

  async reject(id: string): Promise<{ readonly id: string }> {
    const pending = await this.findPendingApproval(id)
    const record = await this.readDelivered(pending.path)
    if (record.type !== 'git_handoff') throw new ServiceError('invalid-handoff', `Pending approval ${pending.file} is not a git handoff.`)
    await unlink(pending.path)
    await writeFile(join(this.options.projectRoot, '.swarmforge', 'notify', `reject-${record.task}`), '', 'utf8')
    const master = this.options.roster.roles.find(({ worktree }) => worktree === 'master')
    if (master === undefined) throw new ServiceError('unknown-role', 'Roster has no master role.')
    await this.options.wake(master.name, `Rejected: ${record.task}`)
    return { id }
  }

  async submitClarification(role: string, question: string): Promise<{ readonly clarificationId: string }> {
    this.requireRole(role)
    if (question.length > 500) throw new ServiceError('invalid-clarification', 'Clarification question must be at most 500 characters.')
    const sequence = this.nextSequence(`clarification:${role}`)
    const clarificationId = `clar-${formatUtcTimestamp(this.options.now())}-${sequence.toString().padStart(6, '0')}`
    await writeFile(join(this.clarificationPath('pending'), `${clarificationId}.request`), `role: ${role}\n\n${question}`, 'utf8')
    return { clarificationId }
  }

  async listClarifications(): Promise<readonly Clarification[]> {
    const directory = this.clarificationPath('pending')
    const files = (await readdir(directory)).sort()
    return Promise.all(files.map(async (file) => {
      const content = await readFile(join(directory, file), 'utf8')
      const separator = content.indexOf('\n\n')
      if (!content.startsWith('role: ') || separator < 0) throw new ServiceError('invalid-handoff', `Invalid clarification request ${file}.`)
      return { id: file.replace(/\.request$/u, ''), role: content.slice(6, separator), question: content.slice(separator + 2), file }
    }))
  }

  async answerClarification(id: string, answer: string): Promise<{ readonly clarificationId: string }> {
    const file = `${id}.request`
    const source = join(this.clarificationPath('pending'), file)
    let content: string
    try {
      content = await readFile(source, 'utf8')
    } catch (error: unknown) {
      if (isNotFound(error)) throw new ServiceError('clarification-not-found', `Clarification "${id}" was not found.`)
      throw error
    }
    const separator = content.indexOf('\n\n')
    if (!content.startsWith('role: ') || separator < 0) throw new ServiceError('invalid-handoff', `Invalid clarification request ${file}.`)
    const role = content.slice(6, separator)
    this.requireRole(role)
    await rename(source, join(this.clarificationPath('answered'), file))
    await this.options.wake(role, `[${id}] ${answer}`)
    return { clarificationId: id }
  }

  async readyForNext(roleName: string): Promise<ReadyResult> {
    const role = this.requireRole(roleName)
    if (role.mode === 'batch') return this.readyForBatch(roleName)
    const inProcess = await this.sortedFiles(roleName, HANDOFF_PATHS.inboxInProcess)
    if (inProcess.length > 1) {
      throw new ServiceError('ambiguous-in-process', `Role "${roleName}" has multiple in-process handoffs.`, inProcess)
    }
    const current = inProcess[0]
    if (current !== undefined) return { status: 'RESUME', ...await this.readTask(roleName, current) }

    const queued = await this.sortedFiles(roleName, HANDOFF_PATHS.inboxNew)
    const file = queued[0]
    if (file === undefined) return { status: 'NO_TASK' }
    const source = this.ownerPath(roleName, HANDOFF_PATHS.inboxNew, file)
    const destination = this.ownerPath(roleName, HANDOFF_PATHS.inboxInProcess, file)
    await rename(source, destination)
    const record = await this.readDelivered(destination)
    if (record.recipient === undefined || record.enqueued_at === undefined) {
      throw new ServiceError('invalid-handoff', `Handoff ${file} lacks delivery lifecycle fields.`)
    }
    const dequeued = { ...record, ...stampDequeue(record as Parameters<typeof stampDequeue>[0], this.options.now()) } as DeliveredHandoff
    await writeFile(destination, formatDeliveredHandoff(dequeued), 'utf8')
    if (dequeued.type === 'git_handoff') {
      try {
        await this.options.gitOps.mergeInto(role.cwd, dequeued.from, dequeued.commit)
      } catch (error: unknown) {
        if (hasConflict(error)) {
          const structured = new ServiceError('merge-conflict', `Merge conflict while processing ${file}.`, [error])
          Object.assign(structured, { file })
          throw structured
        }
        throw error
      }
    }
    return { status: 'TASK', ...taskDetails(dequeued, file) }
  }

  private async readyForBatch(roleName: string): Promise<ReadyResult> {
    const role = this.requireRole(roleName)
    const inProcessDirectory = this.ownerPath(roleName, HANDOFF_PATHS.inboxInProcess, '')
    const inProcess = await readdir(inProcessDirectory, { withFileTypes: true })
    const batches = inProcess.filter((entry) => entry.isDirectory() && entry.name.startsWith('batch_')).map(({ name }) => name).sort()
    if (batches.length > 1 || inProcess.some((entry) => entry.isFile())) {
      throw new ServiceError('ambiguous-in-process', `Role "${roleName}" has ambiguous in-process batch state.`, inProcess.map(({ name }) => name))
    }
    const currentBatch = batches[0]
    if (currentBatch !== undefined) return this.readBatch(inProcessDirectory, currentBatch)

    const queued = await this.sortedFiles(roleName, HANDOFF_PATHS.inboxNew)
    const first = queued[0]
    if (first === undefined) return { status: 'NO_TASK' }
    const priority = first.slice(0, 2)
    const files = queued.filter((file) => file.startsWith(`${priority}_`))
    const batchName = `batch_${formatUtcTimestamp(this.options.now())}_${this.nextSequence(`batch:${roleName}`).toString().padStart(6, '0')}`
    const batchDirectory = join(inProcessDirectory, batchName)
    await mkdir(batchDirectory)
    for (const file of files) {
      await rename(this.ownerPath(roleName, HANDOFF_PATHS.inboxNew, file), join(batchDirectory, file))
    }
    const records: DeliveredHandoff[] = []
    for (const file of files) {
      const path = join(batchDirectory, file)
      const record = await this.readDelivered(path)
      if (record.recipient === undefined || record.enqueued_at === undefined) {
        throw new ServiceError('invalid-handoff', `Handoff ${file} lacks delivery lifecycle fields.`)
      }
      const dequeued = { ...record, ...stampDequeue(record as Parameters<typeof stampDequeue>[0], this.options.now()) } as DeliveredHandoff
      await writeFile(path, formatDeliveredHandoff(dequeued), 'utf8')
      records.push(dequeued)
    }
    for (const [index, record] of records.entries()) {
      if (record.type !== 'git_handoff') continue
      try {
        await this.options.gitOps.mergeInto(role.cwd, record.from, record.commit)
      } catch (error: unknown) {
        if (hasConflict(error)) {
          const structured = new ServiceError('merge-conflict', `Merge conflict while processing batch ${batchName}.`, [error])
          Object.assign(structured, { files, file: files[index] })
          throw structured
        }
        throw error
      }
    }
    return { status: 'BATCH', items: records.map(batchItem) }
  }

  private async readBatch(inProcessDirectory: string, batchName: string): Promise<ReadyResult> {
    const directory = join(inProcessDirectory, batchName)
    const files = (await readdir(directory)).sort(compareHandoffFilenames)
    const records = await Promise.all(files.map((file) => this.readDelivered(join(directory, file))))
    return { status: 'BATCH', items: records.map(batchItem) }
  }

  async doneWithCurrent(roleName: string): Promise<{ readonly file: string }> {
    this.requireRole(roleName)
    const files = await this.sortedFiles(roleName, HANDOFF_PATHS.inboxInProcess)
    if (files.length === 0) throw new ServiceError('no-current-task', `Role "${roleName}" has no in-process handoff.`)
    if (files.length > 1) throw new ServiceError('ambiguous-in-process', `Role "${roleName}" has multiple in-process handoffs.`, files)
    const file = files[0]
    if (file === undefined) throw new ServiceError('no-current-task', `Role "${roleName}" has no in-process handoff.`)
    const source = this.ownerPath(roleName, HANDOFF_PATHS.inboxInProcess, file)
    const record = await this.readDelivered(source)
    if (record.recipient === undefined || record.enqueued_at === undefined || record.dequeued_at === undefined) {
      throw new ServiceError('invalid-handoff', `Handoff ${file} lacks dequeue lifecycle fields.`)
    }
    const completed = { ...record, ...stampCompletion(record as Parameters<typeof stampCompletion>[0], this.options.now()) } as DeliveredHandoff
    await writeFile(source, formatDeliveredHandoff(completed), 'utf8')
    await rename(source, this.ownerPath(roleName, HANDOFF_PATHS.inboxCompleted, file))
    return { file }
  }

  async processRootOutbox(): Promise<{ readonly processed: readonly string[] }> {
    const rootOutbox = join(this.options.projectRoot, '.swarmforge', 'handoffs', HANDOFF_PATHS.projectOutbox)
    const entries = await readdir(rootOutbox, { withFileTypes: true })
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort(compareHandoffFilenames)
    const sent = join(rootOutbox, 'sent')
    await mkdir(sent, { recursive: true })
    for (const file of files) {
      const source = join(rootOutbox, file)
      const record = await this.readDelivered(source)
      const recipients = record.to.split(',').map((recipient) => recipient.trim())
      for (const recipient of recipients) this.requireRole(recipient)
      await this.deliverToRecipients(record, recipients, file)
      const archive = record.from === '(New Task)'
        ? join(sent, file)
        : this.ownerPath(this.requireRole(record.from).name, HANDOFF_PATHS.ownerOutboxSent, file)
      await rename(source, archive)
      for (const recipient of recipients) await this.options.wake(recipient, WAKE_TEXT)
    }
    return { processed: files }
  }

  private async sendLocked(senderRole: string, draft: Readonly<Record<string, unknown>>): Promise<SendResult> {
    const sender = this.options.roster.byRole.get(senderRole)
    if (sender === undefined) throw new ServiceError('unknown-role', `Unknown sender role "${senderRole}".`)

    const sequence = this.nextSequence(senderRole)
    const now = this.options.now()
    const validation = validateDraft(draft, new Set(this.options.roster.byRole.keys()))
    if (!validation.ok) {
      await this.archiveRejectedDraft(senderRole, now, sequence, draft)
      throw new ServiceError('invalid-draft', 'Handoff draft validation failed.', validation.errors)
    }

    let validated = validation.value
    let artifacts: readonly string[] = []
    if (validated.type === 'git_handoff') {
      const commit = await this.resolveCommit(sender.cwd, validated)
      artifacts = await this.options.gitOps.changedFiles(sender.cwd, commit)
      validated = { ...validated, commit }
    }

    const id = createHandoffId({ now, sequence, sender: senderRole })
    const file = generateHandoffFilename({
      now,
      sequence,
      sender: senderRole,
      priority: validated.priority,
      recipients: validated.recipients,
    })
    const record = createSenderRecord(id, senderRole, now, validated, artifacts)
    const tmp = this.ownerPath(senderRole, HANDOFF_PATHS.ownerOutboxTmp, file)
    await writeFile(tmp, formatDeliveredHandoff(record), 'utf8')

    if (this.shouldHold(senderRole, validated, record)) {
      await rename(tmp, join(this.handoffsPath(HANDOFF_PATHS.pendingApproval), file))
      await this.moveTaskIfPresent(validated.task, validated.recipients[0])
      return { id, file }
    }

    try {
      await this.deliverToRecipients(record, validated.recipients, file)
      await rename(tmp, this.ownerPath(senderRole, HANDOFF_PATHS.ownerOutboxSent, file))
    } catch (error: unknown) {
      await rename(tmp, this.ownerPath(senderRole, HANDOFF_PATHS.ownerOutboxFailed, file)).catch(() => undefined)
      throw new ServiceError('delivery-failed', `Could not deliver handoff ${id}.`, [error])
    }
    for (const recipient of validated.recipients) await this.options.wake(recipient, WAKE_TEXT)
    await this.moveTaskIfPresent(validated.task, validated.recipients[0])
    return { id, file }
  }

  private async resolveCommit(cwd: string, draft: ValidatedDraft): Promise<string> {
    if (draft.commit === undefined) return this.options.gitOps.worktreeHead(cwd)
    const commit = await this.options.gitOps.validateCommit(cwd, draft.commit)
    if (!(await this.options.gitOps.commitReachableFromHead(cwd, commit))) {
      throw new ServiceError('commit-not-reachable', `Commit ${commit} is not reachable from sender HEAD.`)
    }
    return commit
  }

  private async deliverToRecipients(record: DeliveredHandoff, recipients: readonly string[], file: string): Promise<void> {
    const staged = await Promise.all(recipients.map(async (recipient) => {
      const stamped = { ...record, ...stampDelivery(record as SenderRecord, recipient, this.options.now()) } as DeliveredHandoff
      const destination = this.ownerPath(recipient, HANDOFF_PATHS.inboxNew, file)
      const staging = `${destination}.tmp`
      await writeFile(staging, formatDeliveredHandoff(stamped), 'utf8')
      return { staging, destination }
    }))
    for (const copy of staged) await rename(copy.staging, copy.destination)
  }

  private async archiveRejectedDraft(
    sender: string,
    now: Date,
    sequence: number,
    draft: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const id = createHandoffId({ now, sequence, sender })
    await writeFile(this.ownerPath(sender, HANDOFF_PATHS.ownerOutboxFailed, `${id}.failed.json`), `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
  }

  private ownerPath(owner: string, relative: string, file: string): string {
    return join(this.options.projectRoot, '.swarmforge', 'handoffs', owner, relative, file)
  }

  private handoffsPath(relative: string): string {
    return join(this.options.projectRoot, '.swarmforge', 'handoffs', relative)
  }

  private clarificationPath(state: 'pending' | 'answered'): string {
    return join(this.options.projectRoot, '.swarmforge', 'dashboard', 'clarifications', state)
  }

  private tasksPath(): string {
    return join(this.options.projectRoot, '.swarmforge', 'board', 'tasks.tsv')
  }

  private taskBodyPath(name: string): string {
    return join(this.options.projectRoot, '.swarmforge', 'board', `${name}.txt`)
  }

  private async writeTasks(tasks: readonly BoardTask[]): Promise<void> {
    const content = tasks.map((task) => `${task.name}\t${task.lane}\t${task.createdAt}\t${task.updatedAt}`).join('\n')
    await writeFile(this.tasksPath(), content.length === 0 ? '' : `${content}\n`, 'utf8')
  }

  private async moveTaskIfPresent(name: string | undefined, lane: string | undefined): Promise<void> {
    if (name === undefined || lane === undefined) return
    const tasks = await this.listTasks()
    if (tasks.some((task) => task.name === name)) await this.moveTask(name, lane)
  }

  private shouldHold(senderRole: string, draft: ValidatedDraft, record: DeliveredHandoff): boolean {
    return draft.type === 'git_handoff'
      && this.options.roster.byRole.has('specifier')
      && this.requireRole(senderRole).worktree === 'master'
      && draft.recipients.length === 1
      && record.approved !== true
  }

  private async findPendingApproval(id: string): Promise<{ readonly file: string; readonly path: string }> {
    const directory = this.handoffsPath(HANDOFF_PATHS.pendingApproval)
    for (const file of await readdir(directory)) {
      const path = join(directory, file)
      const record = await this.readDelivered(path)
      if (record.id === id) return { file, path }
    }
    throw new ServiceError('approval-not-found', `Pending approval "${id}" was not found.`)
  }

  private requireRole(roleName: string) {
    const role = this.options.roster.byRole.get(roleName)
    if (role === undefined) throw new ServiceError('unknown-role', `Unknown role "${roleName}".`)
    return role
  }

  private async sortedFiles(owner: string, relative: string): Promise<string[]> {
    return (await readdir(this.ownerPath(owner, relative, ''))).sort(compareHandoffFilenames)
  }

  private async readDelivered(path: string): Promise<DeliveredHandoff> {
    const parsed = parseDeliveredHandoff(await readFile(path, 'utf8'))
    if (!parsed.ok) throw new ServiceError('invalid-handoff', `Could not parse delivered handoff ${path}.`, parsed.errors)
    return parsed.value
  }

  private async readTask(owner: string, file: string): Promise<TaskDetails> {
    return taskDetails(await this.readDelivered(this.ownerPath(owner, HANDOFF_PATHS.inboxInProcess, file)), file)
  }

  private nextSequence(sender: string): number {
    // M0 keeps counters in memory. A restart resets seq, while the timestamp preserves practical uniqueness and order.
    const sequence = this.sequences.get(sender) ?? 0
    this.sequences.set(sender, sequence + 1)
    return sequence
  }

  private async withSenderLock<T>(sender: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.senderLocks.get(sender) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.senderLocks.set(sender, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.senderLocks.get(sender) === queued) this.senderLocks.delete(sender)
    }
  }
}

function taskDetails(record: DeliveredHandoff, file: string): TaskDetails {
  return {
    from: record.from,
    type: record.type,
    priority: record.priority,
    ...(record.task === undefined ? {} : { taskName: record.task }),
    payload: record.type === 'git_handoff' ? record.commit : record.message,
    file,
  }
}

function batchItem(record: DeliveredHandoff): BatchItem {
  return {
    from: record.from,
    type: record.type,
    taskName: record.task,
    payload: record.type === 'git_handoff' ? record.commit : record.message,
  }
}

function hasConflict(error: unknown): error is { readonly conflict: true } {
  return typeof error === 'object' && error !== null && 'conflict' in error && error.conflict === true
}

function isNotFound(error: unknown): error is { readonly code: 'ENOENT' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function createSenderRecord(
  id: string,
  sender: string,
  now: Date,
  draft: ValidatedDraft,
  artifacts: readonly string[],
): DeliveredHandoff {
  const common = {
    id,
    from: sender,
    to: draft.to,
    priority: draft.priority,
    role: sender,
    created_at: now.toISOString(),
  }
  if (draft.type === 'git_handoff') {
    if (draft.task === undefined || draft.commit === undefined) throw new Error('validated git handoff is incomplete')
    return { ...common, type: draft.type, task: draft.task, commit: draft.commit, artifacts: artifacts.join(',') }
  }
  if (draft.message === undefined) throw new Error('validated note is incomplete')
  return { ...common, type: draft.type, message: draft.message, ...(draft.task === undefined ? {} : { task: draft.task }) }
}

const taskNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

function validateTaskName(name: string): void {
  if (name.length === 0) throw new ServiceError('invalid-task', 'Task name is required.')
  if (name.length > 80) throw new ServiceError('invalid-task', 'Task name must be at most 80 characters.')
  if (!taskNamePattern.test(name)) throw new ServiceError('invalid-task', 'Task name must be kebab-case using lowercase letters, digits, and hyphens.')
}
