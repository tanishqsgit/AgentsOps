'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, FileText, GitBranch, Plus } from 'lucide-react';
import { type Api, type Employee, type Task, type Team, dateLabel } from './data';
import { Schedules } from './schedules';
import { Button } from './ui/button';
import { AssigneeField, TaskDetail } from './work';

type Run = { taskId: string; status: string; createdAt: string; updatedAt: string };
const runsPath = '/workflows/release-brief-review/runs';
const filters = ['All', 'Awaiting approval', 'Finished', 'Ready for review'] as const;

function label(task: Task | undefined, run?: Run) {
  if (!run) return task?.status === 'succeeded' ? 'Ready for review' : task?.status ?? 'Pending';
  if (run.status === 'suspended') return 'Awaiting approval';
  return run.status === 'success' ? 'Finished' : run.status;
}

export function Workflows({ tasks, employees, teams, owner, api, openTask }: {
  tasks: Task[]; employees: Employee[]; teams: Team[]; owner: boolean; api: Api;
  openTask: (id: string) => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [loadedTask, setLoadedTask] = useState<Task>();
  const [filter, setFilter] = useState<(typeof filters)[number]>('All');
  const [launching, setLaunching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const taskById = Object.fromEntries(tasks.filter(task => task.output_format === 'release_brief').map(task => [task.id, task]));
  const runById = Object.fromEntries(runs.map(run => [run.taskId, run]));
  const ids = [...new Set([...runs.map(run => run.taskId), ...Object.keys(taskById)])];
  const selection = selectedId;
  const selected = taskById[selection] ?? (loadedTask?.id === selection ? loadedTask : undefined);
  const names = Object.fromEntries(employees.map(person => [person.id, person.name]));
  const visible = ids.filter(id => filter === 'All' || label(taskById[id], runById[id]) === filter);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await api<{ total: number; runs: Run[] }>(runsPath);
        if (active) { setRuns(result.runs); setTotal(result.total); setLoading(false); }
      } catch (error) { if (active) { setError(String(error)); setLoading(false); } }
    }
    void refresh();
    const timer = setInterval(refresh, 3500);
    return () => { active = false; clearInterval(timer); };
  }, [api]);

  const needsTask = Boolean(selection && !selected);
  useEffect(() => {
    if (!needsTask) return;
    let active = true;
    api<Task>('/tasks/' + selection).then(task => { if (active) setLoadedTask(task); })
      .catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [api, selection, needsTask]);

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const [type, assignee] = String(fields.get('assignee')).split(':');
    const id = crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const task = await api<Task>('/tasks', 'POST', { id, [type]: assignee, prompt: fields.get('prompt'), outputFormat: 'release_brief' });
      setLoadedTask(task);
      setSelectedId(task.id);
      setFilter('All');
      setLaunching(false);
      if (task.status === 'succeeded') await api('/tasks/' + task.id + '/review', 'POST');
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }

  function returnToRuns() {
    setSelectedId('');
    setLaunching(false);
    setError('');
  }

  if (launching || selection) return <div className="focused-panel">
    <button type="button" disabled={busy} onClick={returnToRuns}><ArrowLeft size={16} /> Back to workflows</button>
    {error && <p className="error" role="alert">{error}</p>}
    {launching ? <section className="panel pad"><h2>Start release brief review</h2>
        <form className="form" onSubmit={launch}>
          <AssigneeField employees={employees} teams={teams} />
          <label>Feedback and release context<textarea name="prompt" required rows={6} maxLength={20000}
            placeholder="Include the feedback, release goal, and changes to consider." /></label>
          <div className="actions"><Button disabled={busy}>{busy ? 'Generating brief…' : 'Generate brief and start review'}</Button>
            <button type="button" disabled={busy} onClick={returnToRuns}>Cancel</button></div>
        </form>
      </section> : selected ? <TaskDetail key={selected.id} task={selected} api={api} names={names} owner={owner} />
        : !error && <p className="panel empty">Loading run details…</p>}
  </div>;

  return <div className="workflow-library">
    {error && <p className="error" role="alert">{error}</p>}
    <section className="panel">
      <div className="panel-head"><h2>Templates</h2></div>
      <div className="workflow-template pad">
        <span className="workflow-template-icon"><GitBranch size={22} /></span>
        <div>
          <h3>Release brief review</h3>
          <p className="muted">Summarize product feedback and submit a brief for the owner’s decision.</p>
          <ol className="workflow-steps">
            <li>Generate brief <ArrowRight size={13} /></li><li>Review brief <ArrowRight size={13} /></li><li>Record decision</li>
          </ol>
        </div>
        <Button onClick={() => setLaunching(true)} disabled={!employees.length || busy}><Plus size={16} /> New run</Button>
      </div>
      {!employees.length && <p className="pad muted">Add an AI employee in People to start a workflow.</p>}
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Run history</h2><span className="muted">{total} workflow runs</span></div>
      <div className="section-tabs panel-tabs" role="group" aria-label="Filter workflow runs">{filters.map(item =>
        <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
      {visible.length ? <div className="workspace-table-wrap"><table className="workspace-table">
        <thead><tr><th scope="col">Run</th><th scope="col">Assignee</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
        <tbody>{visible.map(id => {
          const task = taskById[id];
          const run = runById[id];
          const time = run?.updatedAt ?? task?.created_at;
          return <tr key={id}>
            <td><button className="run-link" onClick={() => setSelectedId(id)}><FileText size={16} />
              <span>{task?.result_data?.title ?? task?.prompt ?? 'Release brief run'}</span></button></td>
            <td>{task ? names[task.employee_id] ?? 'Employee' : '—'}</td>
            <td><span className={'pill ' + (run?.status === 'suspended' ? 'running' : '')}>{label(task, run)}</span></td>
            <td>{time ? dateLabel(time) : '—'}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="empty">{loading ? 'Loading workflow runs…' : 'No runs match this view.'}</p>}
    </section>
    {owner && <Schedules api={api} employees={employees} teams={teams} openTask={openTask} />}
  </div>;
}
