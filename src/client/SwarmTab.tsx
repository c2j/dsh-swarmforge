import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'

import type { Clarification, PendingApproval } from '../service/index.js'
import type { ProjectedBoxes, ProjectedTask } from '../projection/types.js'
import type {} from '../projection/types.js'

import { artifactCount, type SwarmView, viewFromToggle } from './commands.js'
import { resolveSwarmProjection } from './projection.js'
import { ensureSwarmStyles } from './swarm-styles.js'

import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'

export interface SwarmTabInjected {
  readonly approve: (id: string) => Promise<string | null>
  readonly reject: (id: string) => Promise<string | null>
  readonly answer: (id: string, text: string) => Promise<string | null>
  readonly createTask: (name: string, text: string) => Promise<string | null>
  readonly moveTask: (name: string, lane: string) => Promise<string | null>
  readonly taskBody: (name: string) => Promise<{ readonly error: string | null; readonly text: string | null }>
}

type SwarmTabProps = ConvViewProps & InjectFace<SwarmTabInjected>

const VIEWS = ['queue', 'board', 'boxes'] as const

export function SwarmTab(props: SwarmTabProps) {
  ensureSwarmStyles()
  const { useProjection, useSessions } = props
  const projection = resolveSwarmProjection(useProjection('swarm'), useSessions((state) => state))
  const [view, setView] = useState<SwarmView>('queue')
  const [error, setError] = useState<string | null>(null)
  if (projection === undefined) return <div className="sf-empty">Swarm not started</div>
  return <div className="sf-root">
    <nav className="sf-tabs" aria-label="Swarm views">
      {VIEWS.map((item) => <button key={item} type="button" className="sf-tab" aria-pressed={view === item} onClick={() => { setView(viewFromToggle(item)) }}>{label(item)}</button>)}
    </nav>
    {error !== null && <p className="sf-alert" role="alert">{error}</p>}
    <div className="sf-body">
      {view === 'queue' && <QueueView approvals={projection.approvals} clarifications={projection.clarifications} {...props} onError={setError} />}
      {view === 'board' && <BoardView tasks={projection.tasks} lanes={projection.boxes.map(({ role }) => role)} {...props} onError={setError} />}
      {view === 'boxes' && <BoxesView boxes={projection.boxes} />}
    </div>
  </div>
}

function label(view: SwarmView): string {
  return `${view[0]?.toUpperCase() ?? ''}${view.slice(1)}`
}

function QueueView({ approvals, clarifications, approve, reject, answer, onError }: {
  readonly approvals: PendingApproval[]
  readonly clarifications: Clarification[]
  readonly approve: SwarmTabInjected['approve']
  readonly reject: SwarmTabInjected['reject']
  readonly answer: SwarmTabInjected['answer']
  readonly onError: (value: string | null) => void
}) {
  return <div className="sf-split">
    <section className="sf-section">
      <h3 className="sf-h">Attention <span className="sf-count">{approvals.length}</span></h3>
      {approvals.length === 0 ? <p className="sf-muted">No pending approvals</p> : approvals.map((item) => <article key={item.id} className="sf-card">
        <p className="sf-title">{item.task}</p>
        <p className="sf-meta">{item.from} → {item.to} · {artifactCount(item.artifacts)} artifacts</p>
        <div className="sf-row">
          <Button variant="primary" size="sm" onClick={() => { void approve(item.id).then(onError) }}>Approve</Button>
          <Button variant="outline" size="sm" onClick={() => { void reject(item.id).then(onError) }}>Reject</Button>
        </div>
      </article>)}
    </section>
    <section className="sf-section">
      <h3 className="sf-h">Clarify <span className="sf-count">{clarifications.length}</span></h3>
      {clarifications.length === 0 ? <p className="sf-muted">No open questions</p> : clarifications.map((item) => <ClarificationRow key={item.id} clarification={item} answer={answer} onError={onError} />)}
    </section>
  </div>
}

function ClarificationRow({ clarification, answer, onError }: {
  readonly clarification: Clarification
  readonly answer: SwarmTabInjected['answer']
  readonly onError: (value: string | null) => void
}) {
  const [text, setText] = useState('')
  return <article className="sf-card">
    <p className="sf-title">{clarification.role}</p>
    <p className="sf-meta">{clarification.question}</p>
    <div className="sf-row">
      <Input aria-label="Answer" placeholder="Type an answer…" value={text} onChange={(event) => { setText(event.target.value) }} />
      <Button variant="primary" size="sm" disabled={text.trim().length === 0} onClick={() => { void answer(clarification.id, text).then((result) => { onError(result); if (result === null) setText('') }) }}>Submit</Button>
    </div>
  </article>
}

function BoardView({ tasks, lanes, createTask, moveTask, taskBody, onError }: {
  readonly tasks: ProjectedTask[]
  readonly lanes: string[]
  readonly createTask: SwarmTabInjected['createTask']
  readonly moveTask: SwarmTabInjected['moveTask']
  readonly taskBody: SwarmTabInjected['taskBody']
  readonly onError: (value: string | null) => void
}) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [detail, setDetail] = useState<string | null>(null)
  return <div className="sf-section">
    <form className="sf-card" onSubmit={(event) => { event.preventDefault(); void createTask(name, text).then((result) => { onError(result); if (result === null) { setName(''); setText('') } }) }}>
      <h3 className="sf-h">New Task</h3>
      <label className="sf-field">
        <Input aria-label="Task name" placeholder="kebab-case-name" value={name} onChange={(event) => { setName(event.target.value) }} />
      </label>
      <label className="sf-field">
        <textarea aria-label="Task text" placeholder="What needs to be done?" value={text} onChange={(event) => { setText(event.target.value) }} />
      </label>
      <div className="sf-row">
        <Button type="submit" variant="primary" size="sm" disabled={name.trim().length === 0 || text.trim().length === 0}>Create</Button>
      </div>
    </form>
    <div className="sf-lanes" style={{ gridTemplateColumns: `repeat(${Math.max(lanes.length, 1)}, minmax(0, 1fr))` }}>
      {lanes.map((lane) => {
        const laneTasks = tasks.filter((task) => task.lane === lane)
        return <section key={lane} className="sf-lane">
          <h3 className="sf-h">{lane} <span className="sf-count">{laneTasks.length}</span></h3>
          {laneTasks.length === 0 ? <p className="sf-muted">No tasks here</p> : laneTasks.map((task) => <article key={task.name} className="sf-card">
            <button type="button" className="sf-link" onClick={() => { void taskBody(task.name).then((result) => { onError(result.error); setDetail(result.text) }) }}>{task.name}</button>
            <p className="sf-meta">{task.updatedAt}</p>
            <label className="sf-field">
              <select aria-label={`Move ${task.name}`} value={task.lane} onChange={(event) => { void moveTask(task.name, event.target.value).then(onError) }}>
                {lanes.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </article>)}
        </section>
      })}
    </div>
    {detail !== null && <pre className="sf-pre">{detail}</pre>}
  </div>
}

function BoxesView({ boxes }: { readonly boxes: ProjectedBoxes[] }) {
  return <div className="sf-split">
    {boxes.length === 0 ? <p className="sf-muted">No role queues yet</p> : boxes.map((box) => <article key={box.role} className="sf-card">
      <p className="sf-title">{box.role}</p>
      <div className="sf-stats">
        <span className="sf-stat">inbox new {box.inbox.new}</span>
        <span className="sf-stat">in process {box.inbox.inProcess}</span>
        <span className="sf-stat">done {box.inbox.completed}</span>
        <span className="sf-stat">sent {box.outbox.sent}</span>
        {box.outbox.failed > 0 && <span className="sf-stat">failed {box.outbox.failed}</span>}
      </div>
      {box.pendingInbox.length + box.pendingOutbox.length === 0
        ? <p className="sf-muted">No pending files</p>
        : <ul className="sf-files">{[...box.pendingInbox, ...box.pendingOutbox].map((file) => <li key={file}>{file}</li>)}</ul>}
    </article>)}
  </div>
}
