'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { Activity as Pulse, Building2, ChevronRight, CircleDot, ClipboardList, GitPullRequest, LayoutDashboard, Library, LogOut, MessagesSquare, Plus, Settings2, UsersRound } from 'lucide-react';
import dynamic from 'next/dynamic';
import { type Activity, type Api, type Company, type Employee, type Task, type Team, dateLabel, employeeActivity, employeeStatus } from './data';
import { People, Teams } from './organization';
import { TaskDesk } from './work';
import { Conversations } from './conversations';
import { Button } from './ui/button';
import { PageHeading } from './ui/page-heading';
import { Settings } from './settings';
import { Workflows } from './workflows';
import { Knowledge } from './knowledge';
import mark from './icon.svg';

const Office = dynamic(() => import('./office'), { ssr: false, loading: () => <p className="empty">Loading the office…</p> });
const sections = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Office', icon: Building2 },
  { name: 'People', icon: UsersRound },
  { name: 'Teams', icon: GitPullRequest },
  { name: 'Tasks', icon: ClipboardList },
  { name: 'Conversations', icon: MessagesSquare },
  { name: 'Workflows', icon: CircleDot },
  { name: 'Knowledge', icon: Library },
  { name: 'Settings', icon: Settings2 },
] as const;
type Section = (typeof sections)[number]['name'];

function Brand() {
  return <div className="brand"><img className="brand-mark" src={mark.src} width={36} height={36} alt="" />AgentOps</div>;
}

export function Console({ url, publishableKey }: { url: string; publishableKey: string }) {
  const supabase = useMemo(() => createClient(url, publishableKey), [url, publishableKey]);
  const [session, setSession] = useState<Session | null>();
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError('');
    setSigningIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(fields.get('email')), password: String(fields.get('password')),
      });
      if (error) setError(error.message);
    } catch (error) {
      setError(String(error));
    } finally {
      setSigningIn(false);
    }
  }

  if (session) return <Home key={session.user.id} session={session} signOut={() => { void supabase.auth.signOut(); }} />;
  return <main className="auth"><div className="auth-card">
    <Brand />
    <h1>Sign in to your workspace</h1>
    {session === undefined ? <p className="muted">Restoring session…</p> : <form className="form" onSubmit={signIn}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <Button disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</Button>
    </form>}
  </div></main>;
}

function Home({ session, signOut }: { session: Session; signOut: () => void }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [section, setSection] = useState<Section>('Overview');
  const [creating, setCreating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const api: Api = useCallback(async (path, method = 'GET', body) => {
    const multipart = body instanceof FormData;
    const response = await fetch('/api/agentops' + path, {
      method, headers: { Authorization: 'Bearer ' + session.access_token, ...(!multipart && { 'Content-Type': 'application/json' }) },
      body: multipart ? body : body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.issues?.[0]?.message ?? data.error ?? 'Request failed.');
    return data;
  }, [session.access_token]);
  const loadCompanies = useCallback(async () => {
    try {
      const rows = await api<Company[]>('/companies');
      setCompanies(rows);
      setCompanyId(current => rows.some(row => row.id === current) ? current : rows[0]?.id ?? '');
    } catch (error) {
      setError(String(error));
    } finally {
      setLoaded(true);
    }
  }, [api]);
  useEffect(() => { void loadCompanies(); }, [loadCompanies]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setCreating(true);
    setError('');
    try {
      const company = await api<Company>('/companies', 'POST', { name: fields.get('name') });
      setCompanies(rows => [{ ...company, access: 'owner' }, ...rows]);
      setCompanyId(company.id);
      setSection('Overview');
      setCreating(false);
    } catch (error) {
      setError(String(error));
    }
  }

  const company = companies.find(row => row.id === companyId);
  return <div className="shell">
    <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
    <aside className="sidebar">
      <Brand />
      <label className="workspace-select">Workspace<select value={companyId} onChange={event => {
        if (event.target.value === 'new') { setCreating(true); return; }
        setCompanyId(event.target.value);
        setCreating(false);
      }}>
        {!company && <option value="">Choose workspace</option>}
        {companies.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        <option value="new">+ New company</option>
      </select></label>
      <nav aria-label="Workspace">{sections.map(({ name, icon: Icon }) =>
        <button key={name} className={section === name ? 'nav active' : 'nav'} aria-current={section === name ? 'page' : undefined}
          onClick={() => { setSection(name); setCreating(false); }}><Icon size={17} /> {name}</button>
      )}</nav>
      <div className="account"><span title={session.user.email}>{session.user.email}</span><button className="icon" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button></div>
    </aside>
    <main id="workspace-content" className="main" tabIndex={-1}>
      <header className="topbar"><span>{company?.name ?? 'Workspace'}</span><ChevronRight size={13} /><strong>{creating ? 'New company' : section}</strong></header>
      {error && <p role="alert" className="error">{error}</p>}
      {(creating || (loaded && !company)) ? <><PageHeading title="Create a company" /><section className="panel onboarding">
        <form className="form" onSubmit={create}>
          <label>Company name<input name="name" required maxLength={120} /></label>
          <Button><Plus size={16} /> Create company</Button>
        </form>
      </section></> : company ? <Workspace key={company.id} company={company} section={section} setSection={setSection} api={api} token={session.access_token} /> : <p className="empty">Loading workspaces…</p>}
    </main>
  </div>;
}

function Workspace({ company, section, setSection, api, token }: {
  company: Company; section: Section; setSection: (section: Section) => void; api: Api; token: string;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [live, setLive] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [thread, setThread] = useState('');
  const [setupPanel, setSetupPanel] = useState(false);
  const [error, setError] = useState('');
  const call: Api = useCallback((path, method, body) => api('/companies/' + company.id + path, method, body), [api, company.id]);
  const refreshRoster = useCallback(async () => {
    try {
      const [people, groups] = await Promise.all([call<Employee[]>('/employees'), call<Team[]>('/teams')]);
      setEmployees(people);
      setTeams(groups);
      setError('');
    } catch (error) {
      setError(String(error));
    }
  }, [call]);
  useEffect(() => { void refreshRoster(); }, [refreshRoster]);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const [queue, events] = await Promise.all([call<Task[]>('/tasks'), call<Activity[]>('/activity')]);
        if (active) { setTasks(queue); setActivity(events); setLive(true); }
      } catch {
        if (active) setLive(false);
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 2500);
    const offline = () => setLive(false);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', offline);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', offline);
    };
  }, [call]);

  function openTask(id: string) { setTaskId(id); setCreatingTask(!id); setSection('Tasks'); }
  const names = Object.fromEntries(employees.map(employee => [employee.id, employee.name]));
  const working = new Set(activity.filter(event => event.status === 'running').map(event => event.employee_id)).size;
  const pending = activity.filter(event => event.kind === 'review').length;
  const awaiting = new Set(activity.filter(event => event.kind === 'review').map(event => event.task_id));
  const needsAttention = tasks.filter(task => awaiting.has(task.id) || task.status === 'failed').slice(0, 5);
  const titles = { Overview: company.name, Office: 'Office', People: 'People', Teams: 'Teams',
    Tasks: 'Tasks', Conversations: 'Conversations', Workflows: 'Workflows', Knowledge: 'Knowledge', Settings: 'Settings' };
  return <>
    <PageHeading title={titles[section]}
      description={section === 'Overview' ? 'Manage your AI employees and follow the work in progress.' : undefined}
      action={<span className={live ? 'connection live' : 'connection'}><i />{live ? 'Live activity' : 'Activity may be stale'}</span>} />
    {error && <p className="error" role="alert">{error}</p>}
    {section === 'Overview' && <>
      <div className="stats">
        {[{ label: 'AI employees', value: employees.length, icon: UsersRound },
          { label: 'Working now', value: working, icon: Pulse },
          { label: 'Awaiting approval', value: pending, icon: CircleDot },
          { label: 'Completed tasks', value: tasks.filter(task => task.status === 'succeeded').length, icon: ClipboardList }].map(({ label, value, icon: Icon }) =>
          <div className="stat" key={label}><Icon size={17} /><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {needsAttention.length > 0 && <section className="panel overview-attention">
        <div className="panel-head"><h2>Needs attention</h2></div>
        {needsAttention.map(task => <button className="row row-button" key={task.id} onClick={() => openTask(task.id)}>
          <strong>{task.result_data?.title ?? task.prompt}</strong>
          <span className={'pill ' + (awaiting.has(task.id) ? 'running' : 'failed')}>{awaiting.has(task.id) ? 'Awaiting approval' : 'Failed'}</span>
        </button>)}
      </section>}
      <div className="columns overview">
        <section className="panel"><div className="panel-head"><h2>Recent tasks</h2><Button onClick={() => openTask('')}><Plus size={16} /> New task</Button></div>
          {tasks.length ? tasks.slice(0, 7).map(task => <button className="row row-button" key={task.id} onClick={() => openTask(task.id)}>
            <div><strong>{task.result_data?.title ?? task.prompt}</strong><small>{names[task.employee_id] ?? 'Employee'} · {dateLabel(task.created_at)}</small></div>
            <span className={'pill ' + task.status}>{task.status}</span>
          </button>) : <p className="empty">No tasks yet.</p>}
        </section>
        <section className="panel"><div className="panel-head"><h2>Agent status</h2><button onClick={() => setSection('Office')}>Open office <ChevronRight size={14} /></button></div>
          {employees.length ? employees.map(employee => {
            const event = employeeActivity(activity, employee.id);
            return <div className="row" key={employee.id}><div className="person"><span className="monogram">{employee.name.slice(0, 2)}</span>
              <div><strong>{employee.name}</strong><small>{employee.role}</small></div></div><span className="muted">{employeeStatus(event)}</span></div>;
          }) : <p className="empty">Add your first AI employee under People.</p>}
        </section>
      </div>
    </>}
    <Conversations employees={employees} api={call} companyId={company.id} token={token} choice={thread} setChoice={setThread}
      visible={section === 'Office' || section === 'Conversations'} teams={teams} tasks={tasks} activity={activity} openTask={openTask}
      office={section === 'Office' ? selectedThread => <Office employees={employees} activity={activity} openTask={openTask}
        choice={selectedThread} select={setThread} /> : undefined}
      openFull={() => setSection('Conversations')}
      setupPanel={company.access === 'owner' ? () => { setSetupPanel(true); setSection('Teams'); } : undefined} />
    {section === 'People' && <People employees={employees} owner={company.access === 'owner'} api={call} refresh={refreshRoster} />}
    {section === 'Teams' && <Teams employees={employees} teams={teams} tasks={tasks} owner={company.access === 'owner'} api={call} refresh={refreshRoster}
      createPanel={setupPanel} doneCreatingPanel={team => {
        setSetupPanel(false);
        if (team) { setThread('team:' + team.id); setSection('Conversations'); }
      }} />}
    {section === 'Tasks' && <TaskDesk tasks={tasks} teams={teams}
      employees={employees} activity={activity} taskId={taskId} setTaskId={setTaskId}
      creating={creatingTask} setCreating={setCreatingTask}
      owner={company.access === 'owner'} api={call} />}
    {section === 'Workflows' && <Workflows tasks={tasks} teams={teams} employees={employees} owner={company.access === 'owner'} api={call} openTask={openTask} />}
    {section === 'Knowledge' && <Knowledge api={call} owner={company.access === 'owner'} openPeople={() => setSection('People')} />}
    {section === 'Settings' && <Settings employees={employees} api={call} owner={company.access === 'owner'} />}
  </>;
}
