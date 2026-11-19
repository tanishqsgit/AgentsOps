'use client';

import { useEffect, useState } from 'react';
import type { Api, Employee, Team } from './data';
import { Button } from './ui/button';
import { AssigneeField } from './work';

type Schedule = { id: string; metadata?: { name?: string }; cron?: string; timezone?: string; nextFireAt?: number; status: string };
type Trigger = { id?: string; actualFireAt: number; outcome: string; triggerKind?: string; task?: { id: string; status: string } | null };
const taskStatus: Record<string, string> = { queued: 'Queued', running: 'Running', succeeded: 'Completed', failed: 'Failed' };

export function Schedules({ api, employees, teams, openTask }: {
  api: Api; employees: Employee[]; teams: Team[]; openTask: (id: string) => void;
}) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [mode, setMode] = useState('once');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<Trigger[]>();
  useEffect(() => {
    api<Schedule[]>('/schedules').then(setItems).catch(error => setError(error.message));
  }, [api]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const refresh = () => api<Trigger[]>('/schedules/' + selected + '/history')
      .then(items => { if (active) setHistory(items); })
      .catch(error => { if (active) setError(error.message); });
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [api, selected]);

  async function update(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setItems(await api<Schedule[]>('/schedules'));
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-head"><h2>Schedules</h2></div>
    {items.map(item => <div key={item.id}><div className="row">
      <div><strong>{item.metadata?.name ?? 'Scheduled task'}</strong>
        <small>{item.status}{item.cron ? ' · ' + item.cron + ' · ' + (item.timezone ?? 'UTC') : ''}
          {item.nextFireAt && item.status === 'active' ? ' · Next ' + new Date(item.nextFireAt).toLocaleString() : ''}</small></div>
      <div className="actions">
        {item.status === 'active' && item.cron && <button type="button" disabled={busy}
          onClick={() => update(() => api('/schedules/' + item.id + '/action', 'POST', { action: 'run' }))}>Run now</button>}
        {(item.status === 'active' || item.status === 'paused') && <button type="button" disabled={busy}
          onClick={() => update(() => api('/schedules/' + item.id + '/action', 'POST', { action: item.status === 'active' ? 'pause' : 'resume' }))}>
          {item.status === 'active' ? 'Pause' : 'Resume'}</button>}
        <button type="button" aria-expanded={selected === item.id} onClick={() => {
          setHistory(undefined);
          setSelected(selected === item.id ? '' : item.id);
        }}>History</button>
        <button type="button" disabled={busy} onClick={() => update(async () => {
          await api('/schedules/' + item.id, 'DELETE');
          if (selected === item.id) setSelected('');
        })}>Remove schedule</button>
      </div>
    </div>
    {selected === item.id && <div className="pad">
      {history?.length ? <ul className="settings-list">{history.map((entry, index) => {
        const task = entry.task;
        return <li key={entry.id ?? index}>
          <span>{new Date(entry.actualFireAt).toLocaleString()}{entry.triggerKind === 'manual' ? ' · Manual' : ''}</span>
          <div className="actions">
            <span className="pill">{task ? taskStatus[task.status] ?? task.status : entry.outcome === 'published' ? 'Dispatched' : entry.outcome}</span>
            {task && <button type="button" onClick={() => openTask(task.id)}>View task</button>}
          </div>
        </li>;
      })}</ul> : <p className="muted">{history ? 'No triggers recorded yet.' : 'Loading trigger history…'}</p>}
    </div>}
    </div>)}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="pad">
      <details><summary>Schedule a task</summary>
        {employees.length ? <form className="form" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          const [assignee, id] = String(fields.get('assignee')).split(':');
          void update(async () => {
            const timing = mode === 'once' ? { runAt: new Date(String(fields.get('runAt'))).toISOString() } :
              { cron: fields.get('cron'), timezone: fields.get('timezone') };
            await api('/schedules', 'POST', { name: fields.get('name'), ...timing,
              task: { id: crypto.randomUUID(), [assignee]: id, prompt: fields.get('prompt'), outputFormat: fields.get('format') } });
            form.reset();
          });
        }}>
          <label>Schedule name<input name="name" required maxLength={120} /></label>
          <AssigneeField employees={employees} teams={teams} />
          <label>Deliverable<select name="format"><option value="text">Free-form response</option>
            <option value="release_brief">Release brief with human review</option></select></label>
          <label>Task instructions<textarea name="prompt" required maxLength={20000} rows={4} /></label>
          <label>Frequency<select value={mode} onChange={event => setMode(event.target.value)}>
            <option value="once">One time</option><option value="repeat">Repeat</option>
          </select></label>
          {mode === 'once' ? <label>Run at (local time)<input name="runAt" type="datetime-local" required /></label> : <>
            <label>Cron expression<input name="cron" placeholder="0 9 * * 1" required /></label>
            <label>Time zone<input name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required /></label>
          </>}
          <Button disabled={busy}>Save schedule</Button>
        </form> : <p className="muted">Add an AI employee before scheduling work.</p>}
      </details>
    </div>
  </section>;
}
