'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Pencil, Plus, UserRoundPlus } from 'lucide-react';
import type { Api, Employee, Member, Task, Team } from './data';
import { Button } from './ui/button';

type Manage = { employees: Employee[]; owner: boolean; api: Api; refresh: () => Promise<void> };

export function People({ employees, owner, api, refresh }: Manage) {
  const [tab, setTab] = useState<'employees' | 'members'>('employees');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Employee | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tools, setTools] = useState([{ id: 'feedback-audit', name: 'Feedback audit', provider: 'agentops' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loadMembers = useCallback(async () => {
    if (owner) setMembers(await api<Member[]>('/members'));
  }, [owner, api]);
  useEffect(() => { void loadMembers().catch(error => setError(error.message)); }, [loadMembers]);
  useEffect(() => {
    let active = true;
    api<typeof tools>('/tools').then(result => { if (active) setTools(result); }).catch(() => {});
    return () => { active = false; };
  }, [api]);
  const toolChoices = [...tools, ...(selected?.tool_ids ?? []).filter(id => !tools.some(tool => tool.id === id))
    .map(id => ({ id, name: id, provider: 'Unavailable' }))];
  const visibleEmployees = employees.filter(employee => (employee.name + ' ' + employee.role).toLowerCase().includes(query.trim().toLowerCase()));

  async function run(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try { await action(); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      const fields = new FormData(form);
      await api(selected ? '/employees/' + selected.id : '/employees', selected ? 'PUT' : 'POST', {
        name: fields.get('name'), role: fields.get('role'), instructions: fields.get('instructions'), toolIds: fields.getAll('tool'),
      });
      form.reset();
      setSelected(null);
      await refresh();
    });
  }

  return <>
    {owner && <div className="section-tabs" role="group" aria-label="People views">
      <button onClick={() => setTab('employees')} aria-pressed={tab === 'employees'}>AI employees</button>
      <button onClick={() => setTab('members')} aria-pressed={tab === 'members'}>Company members</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {tab === 'employees' && <div className="columns">
      <section className="panel">
        <div className="panel-head"><h2>AI employees</h2>{owner && <button onClick={() => setSelected(null)}><Plus size={15} /> New employee</button>}</div>
        {employees.length > 0 && <div className="pad"><input type="search" aria-label="Search employees" placeholder="Search employees"
          value={query} onChange={event => setQuery(event.target.value)} /></div>}
        {visibleEmployees.length ? visibleEmployees.map(employee => <div className="row" key={employee.id}>
          <div className="person"><span className="monogram">{employee.name.slice(0, 2)}</span><div><strong>{employee.name}</strong>
            <small>{employee.role} · {employee.tool_ids.length} {employee.tool_ids.length === 1 ? 'tool' : 'tools'}</small></div></div>
          {owner && <button className="icon" aria-label={'Edit ' + employee.name} onClick={() => setSelected(employee)}><Pencil size={15} /></button>}
        </div>) : <p className="empty">{employees.length ? 'No employees match this search.' : 'No AI employees yet.'}</p>}
      </section>
      {owner && <section className="panel pad">
        <h2>{selected ? 'Edit employee' : 'New employee'}</h2>
        <form key={selected?.id ?? 'new'} className="form" onSubmit={save}>
          <label>Name<input name="name" maxLength={120} required defaultValue={selected?.name} /></label>
          <label>Role<input name="role" maxLength={120} required defaultValue={selected?.role} /></label>
          <label>Instructions<textarea name="instructions" rows={5} maxLength={20000} required defaultValue={selected?.instructions} /></label>
          <fieldset><legend>Allowed tools</legend>{toolChoices.map(tool => <label className="check" key={tool.id}>
            <input name="tool" type="checkbox" value={tool.id} defaultChecked={selected?.tool_ids.includes(tool.id)} />
            {tool.name}{tool.provider !== 'agentops' && <small>{tool.provider}</small>}
          </label>)}</fieldset>
          <Button disabled={busy}>{selected ? 'Save employee' : 'Add employee'}</Button>
        </form>
      </section>}
    </div>}
    {owner && tab === 'members' && <section className="panel">
      <div className="panel-head"><h2>Company members</h2></div>
      {members.map(member => <div className="row" key={member.id}><div><strong>{member.email}</strong><small>{member.role}</small></div>
        {member.role !== 'owner' && <button disabled={busy} onClick={() => run(async () => {
          await api('/members/' + member.id, 'DELETE');
          await loadMembers();
        })}>Remove</button>}
      </div>)}
      <form className="inline-form" onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        void run(async () => {
          await api('/members', 'POST', { email: new FormData(form).get('email') });
          form.reset();
          await loadMembers();
        });
      }}>
        <label>Member email<input name="email" type="email" placeholder="name@example.com" required /></label>
        <button disabled={busy}><UserRoundPlus size={16} /> Add member</button>
      </form>
    </section>}
  </>;
}

export function Teams({ employees, teams, tasks, owner, api, refresh, createPanel, doneCreatingPanel }: Manage & {
  teams: Team[]; tasks: Task[]; createPanel: boolean; doneCreatingPanel: (team?: Team) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(createPanel);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const names = Object.fromEntries(employees.map(employee => [employee.id, employee.name]));
  const selected = teams.find(team => team.id === selectedId);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const leadEmployeeId = String(fields.get('lead')) || null;
    const employeeIds = [...new Set([leadEmployeeId, ...fields.getAll('member').map(String)].filter((id): id is string => Boolean(id)))];
    setBusy(true);
    setError('');
    try {
      const team = await api<Team>(selected ? '/teams/' + selected.id : '/teams', selected ? 'PUT' : 'POST',
        { name: fields.get('name'), leadEmployeeId, employeeIds });
      form.reset();
      await refresh();
      setEditing(false);
      if (createPanel) doneCreatingPanel(team);
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }

  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {!(selected || editing) ? <section className="panel"><div className="panel-head"><h2>Team directory</h2>
      {owner && <Button onClick={() => setEditing(true)}><Plus size={15} /> New team</Button>}</div>
        {teams.length ? teams.map(team => <button type="button" className="row row-button" key={team.id} onClick={() => setSelectedId(team.id)}>
          <div><strong>{team.name}</strong><small>{team.lead_employee_id ? 'Lead ' + names[team.lead_employee_id] : 'No lead assigned'} · {team.employee_ids.length} employees</small></div>
          <span className="muted">{tasks.filter(task => task.team_id === team.id && task.status === 'running').length} running</span></button>)
          : <p className="empty">No teams yet.</p>}
      </section> : <div className="focused-panel">
      <button type="button" disabled={busy} onClick={() => {
        setSelectedId(''); setEditing(false); setError('');
        if (createPanel) doneCreatingPanel();
      }}>
        <ArrowLeft size={16} /> Back to team directory</button>
      {editing && owner ? <section className="panel pad"><h2>{selected ? 'Edit team' : 'New team'}</h2>
        {employees.length < 2 ? <p className="muted">Add at least two AI employees to create a team.</p> :
          <form key={selected?.id ?? 'new'} className="form" onSubmit={save}>
            <label>Name<input name="name" required maxLength={120} defaultValue={selected?.name ?? (createPanel ? 'Panel' : undefined)} /></label>
            <label>Lead<select name="lead" required={createPanel} defaultValue={selected?.lead_employee_id ?? ''}><option value="">{createPanel ? 'Choose a lead' : 'No lead'}</option>{employees.map(employee =>
              <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
            <fieldset><legend>Teammates</legend>{employees.map(employee => <label className="check" key={employee.id}>
              <input type="checkbox" name="member" value={employee.id} defaultChecked={selected?.employee_ids.includes(employee.id)} /> {employee.name}
            </label>)}</fieldset>
            <Button disabled={busy}>{selected ? 'Save team' : 'Create team'}</Button>
          </form>}
      </section> : selected && <section className="panel">
        <div className="panel-head"><h2>{selected.name}</h2>{owner && <button type="button" onClick={() => setEditing(true)}>
          <Pencil size={15} /> Edit team</button>}</div>
        {selected.employee_ids.map(id => <div className="row" key={id}>
          <strong>{names[id] ?? 'Employee'}</strong>
          {id === selected.lead_employee_id && <span className="pill">Lead</span>}
        </div>)}
      </section>}
    </div>}
  </>;
}
