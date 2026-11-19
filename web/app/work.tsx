'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Background, Position, ReactFlow, type Node, type Edge } from '@xyflow/react';
import { ArrowLeft, ArrowUpRight, FileText, Plus } from 'lucide-react';
import { AgentMarkdown } from './chat-parts';
import { Button } from './ui/button';
import { type Activity, type Api, type Delegation, type Employee, type Review, type Task, type Team, dateLabel } from './data';

type DeskProps = {
  tasks: Task[]; teams: Team[]; employees: Employee[]; activity: Activity[];
  taskId: string; setTaskId: (id: string) => void; creating: boolean; setCreating: (value: boolean) => void;
  owner: boolean; api: Api;
};

export function TaskDesk({ tasks, teams, employees, activity, taskId, setTaskId, creating, setCreating, owner, api }: DeskProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<Task>();
  const [filter, setFilter] = useState('all');
  const task = tasks.find(task => task.id === taskId) ?? (submitted?.id === taskId ? submitted : undefined);
  const names = Object.fromEntries(employees.map(employee => [employee.id, employee.name]));
  const visible = tasks.filter(item => filter === 'all' || item.status === filter);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const [type, assignee] = String(fields.get('assignee')).split(':');
    const id = crypto.randomUUID();
    const outputFormat = String(fields.get('format'));
    setBusy(true);
    setError('');
    try {
      const saved = await api<Task>('/tasks/background', 'POST', { id, [type]: assignee, prompt: fields.get('prompt'), outputFormat });
      setSubmitted(saved);
      setTaskId(saved.id);
      setCreating(false);
      form.reset();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }

  function backToQueue() {
    setCreating(false);
    setTaskId('');
    setError('');
  }

  if (creating || taskId) return <div className="focused-panel">
    <button type="button" onClick={backToQueue} disabled={busy}><ArrowLeft size={16} /> Back to task queue</button>
    {error && <p role="alert" className="error">{error}</p>}
    {creating ?
        <section className="panel pad">
          <h2>Assign work</h2>
          {employees.length ? <form className="form" onSubmit={submit}>
            <AssigneeField employees={employees} teams={teams} />
            <label>Deliverable<select name="format"><option value="text">Free-form response</option><option value="release_brief">Release brief</option></select></label>
            <label>Task instructions<textarea name="prompt" rows={6} maxLength={20000} placeholder="Describe the work and the expected outcome." required /></label>
            <Button disabled={busy}><ArrowUpRight size={16} /> {busy ? 'Submitting…' : 'Assign task'}</Button>
          </form> : <p className="muted">Add an AI employee under People first.</p>}
        </section> : task ?
          <TaskDetail key={task.id} task={task} api={api} names={names} owner={owner} /> :
          <p className="panel empty">This task is outside the current queue.</p>}
  </div>;

  return <section className="panel">
    <div className="panel-head"><h2>Task queue</h2>
      <Button onClick={() => setCreating(true)} disabled={!employees.length}><Plus size={16} /> New task</Button></div>
    <div className="section-tabs panel-tabs" role="group" aria-label="Filter tasks">
      {Object.entries({ all: 'All', queued: 'Queued', running: 'Running', succeeded: 'Completed', failed: 'Failed' }).map(([status, name]) =>
        <button type="button" key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{name}</button>)}
    </div>
    {visible.length ? <div className="workspace-table-wrap"><table className="workspace-table">
      <thead><tr><th scope="col">Task</th><th scope="col">Assignee</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
      <tbody>{visible.map(item => <tr key={item.id}>
        <td><button className="run-link" onClick={() => setTaskId(item.id)}><FileText size={16} />
          <span>{item.result_data?.title ?? item.prompt}</span></button></td>
        <td>{teams.find(team => team.id === item.team_id)?.name ?? names[item.employee_id] ?? 'Employee'}</td>
        <td><span className={'pill ' + item.status}>{activity.some(event => event.kind === 'review' && event.task_id === item.id) ?
          'In review' : item.status}</span></td>
        <td>{dateLabel(item.created_at)}</td>
      </tr>)}</tbody>
    </table></div> : <p className="empty">{employees.length ? 'No tasks match this view.' : 'Add an AI employee in People before assigning work.'}</p>}
  </section>;
}

export function AssigneeField({ employees, teams }: { employees: Employee[]; teams: Team[] }) {
  const assignableTeams = teams.filter(team => team.lead_employee_id);
  return <label>Assign to<select name="assignee" required><optgroup label="AI employees">{employees.map(employee =>
    <option value={'employeeId:' + employee.id} key={employee.id}>{employee.name}</option>)}</optgroup>
    {!!assignableTeams.length && <optgroup label="Teams">{assignableTeams.map(team =>
      <option value={'teamId:' + team.id} key={team.id}>{team.name}</option>)}</optgroup>}
  </select></label>;
}

export function TaskDetail({ task, api, names, owner }: { task: Task; api: Api; names: Record<string, string>; owner: boolean }) {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [review, setReview] = useState<Review | null>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const path = '/tasks/' + task.id;
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const [steps, decision] = await Promise.all([api<Delegation[]>(path + '/delegations'),
          task.output_format === 'release_brief' && task.status === 'succeeded' ? api<Review | null>(path + '/review') : null]);
        if (mounted) { setDelegations(steps); setReview(decision); setError(''); }
      } catch (error) { if (mounted) setError(String(error)); }
    }
    void refresh();
    const timer = task.status === 'running' || task.output_format === 'release_brief' ? setInterval(refresh, 3500) : undefined;
    return () => { mounted = false; clearInterval(timer); };
  }, [api, path, task.status, task.output_format]);

  async function resolve(approved?: boolean) {
    setBusy(true);
    setError('');
    try {
      setReview(await api<Review>(path + (approved === undefined ? '/review' : '/review/decision'), 'POST',
        approved === undefined ? undefined : { approved, note: note.trim() || undefined }));
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }

  const brief = task.result_data;
  const decision = review?.decision;
  const reviewLabel = decision ? (decision.approved ? 'Approved' : 'Rejected')
    : review?.status === 'suspended' ? 'Awaiting approval' : review?.status ?? 'Ready for review';
  return <section className="panel pad detail">
    <div className="detail-heading"><h2>{brief?.title ?? 'Task details'}</h2><span className={'pill ' + task.status}>{task.status}</span></div>
    <dl className="setting-meta"><div><dt>Employee</dt><dd>{names[task.employee_id] ?? 'Employee'}</dd></div>
      <div><dt>Started</dt><dd>{dateLabel(task.created_at)}</dd></div>
      {task.finished_at && <div><dt>Finished</dt><dd>{dateLabel(task.finished_at)}</dd></div>}
      <div><dt>Run ID</dt><dd><code>{task.id}</code></dd></div></dl>
    <details open={!brief && !task.result}><summary>Task instructions</summary><p className="prewrap">{task.prompt}</p></details>
    {task.error && <p className="error">{task.error}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {brief && <div className="prose"><p>{brief.summary}</p><h3>Changes</h3><ul>{brief.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></div>}
    {task.result && <AgentMarkdown className="prose" text={task.result} />}
    {Boolean(delegations.length) && <div className="handoffs"><h3>Delegations</h3>{delegations.map(step => <details key={step.tool_call_id}>
      <summary>{names[step.employee_id] ?? 'Teammate'} <span className={'pill ' + step.status}>{step.status}</span></summary>
      <p>{step.prompt}</p>{step.result && <AgentMarkdown className="prose" text={step.result} />}
    </details>)}</div>}
    {brief && task.status === 'succeeded' && <div className="review">
      <div className="detail-heading"><h3>Review workflow</h3><span className={'pill ' + (decision?.approved ? 'succeeded' : review?.status === 'suspended' ? 'running' : '')}>{reviewLabel}</span></div>
      <ReviewGraph status={reviewLabel} />
      {review && <dl className="setting-meta"><div><dt>Review started</dt><dd>{dateLabel(review.createdAt)}</dd></div>
        <div><dt>Review updated</dt><dd>{dateLabel(review.updatedAt)}</dd></div>
        {review.step && <div><dt>Review step</dt><dd>{review.step}</dd></div>}</dl>}
      {decision?.note && <p className="review-note"><strong>Reviewer note</strong><span>{decision.note}</span></p>}
      {review?.status === 'suspended' && owner && <label className="review-note"><strong>Reviewer note</strong>
        <textarea aria-label="Reviewer note" rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>}
      <div className="actions">
        {(!review || review.status === 'pending') && review !== undefined && <Button onClick={() => resolve()} disabled={busy}>Start review</Button>}
        {review?.status === 'suspended' && owner && <>
          <Button onClick={() => resolve(true)} disabled={busy}>Approve brief</Button>
          <button onClick={() => resolve(false)} disabled={busy}>Reject brief</button>
        </>}
      </div>
    </div>}
  </section>;
}

function ReviewGraph({ status }: { status: string }) {
  const decided = ['Approved', 'Rejected'].includes(status);
  const nodes: Node[] = [
    { id: 'brief', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Saved release brief' }, className: 'flow-complete' },
    { id: 'review', position: { x: 220, y: 0 }, data: { label: status }, className: status === 'Awaiting approval' ? 'flow-pending' : '' },
    { id: 'end', type: 'output', position: { x: 440, y: 0 }, data: { label: 'Decision recorded' }, className: decided ? 'flow-complete' : '' },
  ];
  const edges: Edge[] = [{ id: 'draft-review', source: 'brief', target: 'review' }, { id: 'review-end', source: 'review', target: 'end' }];
  nodes.forEach(node => Object.assign(node, { sourcePosition: Position.Right, targetPosition: Position.Left }));
  return <div className="flow" aria-label="Review workflow graph"><ReactFlow nodes={nodes} edges={edges} fitView
    nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} zoomOnScroll={false}
    zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}><Background /></ReactFlow></div>;
}
