import { useState } from 'react'

import type { Clarification, PendingApproval } from '../service/index.js'
import type { ProjectedBoxes, ProjectedTask } from '../projection/types.js'
import type {} from '../projection/types.js'

import { artifactCount, type SwarmView, viewFromToggle } from './commands.js'
import { resolveSwarmProjection } from './projection.js'

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

export function SwarmTab(props: SwarmTabProps) {
  const { useProjection, useSessions } = props
  const projection = resolveSwarmProjection(useProjection('swarm'), useSessions((state) => state))
  const [view, setView] = useState<SwarmView>('queue')
  const [error, setError] = useState<string | null>(null)
  if (projection === undefined) return <div>Swarm not started</div>
  return <div>
    <nav aria-label="Swarm views">
      {(['queue', 'board', 'boxes'] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} onClick={() => { setView(viewFromToggle(item)) }}>{item[0]?.toUpperCase()}{item.slice(1)}</button>)}
    </nav>
    {view === 'queue' && <QueueView approvals={projection.approvals} clarifications={projection.clarifications} {...props} onError={setError} />}
    {view === 'board' && <BoardView tasks={projection.tasks} lanes={projection.boxes.map(({ role }) => role)} {...props} onError={setError} />}
    {view === 'boxes' && <BoxesView boxes={projection.boxes} />}
    {error !== null && <p role="alert">{error}</p>}
  </div>
}

function QueueView({ approvals, clarifications, approve, reject, answer, onError }: { readonly approvals: PendingApproval[]; readonly clarifications: Clarification[]; readonly approve: SwarmTabInjected['approve']; readonly reject: SwarmTabInjected['reject']; readonly answer: SwarmTabInjected['answer']; readonly onError: (value: string | null) => void }) {
  return <><section><h3>Attention</h3>{approvals.length === 0 ? <p>No pending approvals</p> : approvals.map((item) => <div key={item.id}><p>{item.task}</p><p>{item.from} → {item.to}</p><p>{artifactCount(item.artifacts)} artifacts</p><button type="button" onClick={() => { void approve(item.id).then(onError) }}>Approve</button><button type="button" onClick={() => { void reject(item.id).then(onError) }}>Reject</button></div>)}</section><section><h3>Clarify</h3>{clarifications.length === 0 ? <p>No open questions</p> : clarifications.map((item) => <ClarificationRow key={item.id} clarification={item} answer={answer} onError={onError} />)}</section></>
}

function ClarificationRow({ clarification, answer, onError }: { readonly clarification: Clarification; readonly answer: SwarmTabInjected['answer']; readonly onError: (value: string | null) => void }) {
  const [text, setText] = useState('')
  return <div><p>{clarification.role}</p><p>{clarification.question}</p><input value={text} placeholder="Type an answer…" onChange={(event) => { setText(event.target.value) }} /><button type="button" disabled={text.trim().length === 0} onClick={() => { void answer(clarification.id, text).then((result) => { onError(result); if (result === null) setText('') }) }}>Submit</button></div>
}

function BoardView({ tasks, lanes, createTask, moveTask, taskBody, onError }: { readonly tasks: ProjectedTask[]; readonly lanes: string[]; readonly createTask: SwarmTabInjected['createTask']; readonly moveTask: SwarmTabInjected['moveTask']; readonly taskBody: SwarmTabInjected['taskBody']; readonly onError: (value: string | null) => void }) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [detail, setDetail] = useState<string | null>(null)
  return <><form onSubmit={(event) => { event.preventDefault(); void createTask(name, text).then((result) => { onError(result); if (result === null) { setName(''); setText('') } }) }}><h3>New Task</h3><input aria-label="Task name" placeholder="kebab-case-name" value={name} onChange={(event) => { setName(event.target.value) }} /><textarea aria-label="Task text" placeholder="What needs to be done?" value={text} onChange={(event) => { setText(event.target.value) }} /><button type="submit" disabled={name.trim().length === 0 || text.trim().length === 0}>Create</button></form><div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(lanes.length, 1)}, minmax(0, 1fr))`, gap: 12 }}>{lanes.map((lane) => <section key={lane}><h3>{lane}</h3>{tasks.filter((task) => task.lane === lane).length === 0 ? <p>No tasks here</p> : tasks.filter((task) => task.lane === lane).map((task) => <div key={task.name}><button type="button" onClick={() => { void taskBody(task.name).then((result) => { onError(result.error); setDetail(result.text) }) }}>{task.name}</button><small>{task.updatedAt}</small><select aria-label={`Move ${task.name}`} value={task.lane} onChange={(event) => { void moveTask(task.name, event.target.value).then(onError) }}>{lanes.map((option) => <option key={option}>{option}</option>)}</select></div>)}</section>)}</div>{detail !== null && <pre>{detail}</pre>}</>
}

function BoxesView({ boxes }: { readonly boxes: ProjectedBoxes[] }) {
  return <section><h3>Role boxes</h3>{boxes.length === 0 ? <p>No role queues yet</p> : boxes.map((box) => <div key={box.role}><h4>{box.role}</h4><p>Inbox · new {box.inbox.new} · in process {box.inbox.inProcess} · completed {box.inbox.completed}</p><p>Outbox · tmp {box.outbox.tmp} · sent {box.outbox.sent} · failed {box.outbox.failed}</p>{box.pendingInbox.length + box.pendingOutbox.length === 0 ? <p>No pending files</p> : <ul>{[...box.pendingInbox, ...box.pendingOutbox].map((file) => <li key={file}>{file}</li>)}</ul>}</div>)}</section>
}
