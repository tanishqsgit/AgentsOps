'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { MessageScroller } from '@shadcn/react/message-scroller';
import { ArrowDown, MessagesSquare, Send } from 'lucide-react';
import { type Activity, type Api, type ChannelThread, type Employee, type Message as SavedMessage, type Task, type Team, channelNames as channels, dateLabel } from './data';
import { ChatPart } from './chat-parts';
import { drawAvatar } from './office-art';
import { Button } from './ui/button';
import { Message, MessageAvatar, MessageContent, MessageHeader } from './ui/message';

type ChatMessage = UIMessage<{ createdAt?: string }>;

function uiMessages(saved: SavedMessage[]): ChatMessage[] {
  return saved.map(message => ({
    id: message.id, role: message.role, metadata: { createdAt: message.createdAt },
    parts: message.parts ?? [{ type: 'text', text: message.text }],
  }));
}

type Channel = keyof typeof channels;
export const teamThreadId = (team: Team) => 'team:' + team.id;

function useConversationRefresh(enabled: boolean, interval: number, refresh: (isCurrent: () => boolean) => Promise<void>) {
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    let pending = false;
    async function poll() {
      if (pending) return;
      pending = true;
      try { await refresh(() => current); } finally { pending = false; }
    }
    void poll();
    const timer = window.setInterval(poll, interval);
    window.addEventListener('online', poll);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('online', poll);
    };
  }, [enabled, interval, refresh]);
}

export function Conversations({ employees, api, companyId, token, choice, setChoice, visible, office, openFull,
  teams, tasks, activity, openTask, setupPanel }: {
  employees: Employee[]; api: Api; companyId: string; token: string;
  choice: string; setChoice: (value: string) => void; visible: boolean;
  office?: (selectedThread: string) => ReactNode; openFull: () => void;
  teams: Team[]; tasks: Task[]; activity: Activity[]; openTask: (id: string) => void; setupPanel?: () => void;
}) {
  const [availableChannels, setAvailableChannels] = useState<Channel[]>([]);
  const [directoryError, setDirectoryError] = useState('');
  const [visited, setVisited] = useState<string[]>([]);
  const refreshDirectory = useCallback(async (isCurrent: () => boolean) => {
    try {
      const ids = await api<Channel[]>('/channel-threads');
      if (!isCurrent()) return;
      setAvailableChannels(ids.filter(id => Object.hasOwn(channels, id)));
      setDirectoryError('');
    } catch {
      if (isCurrent()) setDirectoryError('Connected channels could not be refreshed.');
    }
  }, [api]);
  useConversationRefresh(visible, 12000, refreshDirectory);

  const panelTeam = teams.find(team => team.name.toLowerCase() === 'panel');
  const threads = [
    ...employees.map(employee => ({ id: employee.id, name: employee.name, kind: 'employee' as const, employee })),
    ...teams.map(team => ({ id: teamThreadId(team), name: team.name, kind: 'team' as const, team })),
    ...availableChannels.map(channel => ({ id: channel, name: channels[channel], kind: 'channel' as const })),
  ];
  const active = threads.find(thread => thread.id === choice)?.id
    ?? (Object.hasOwn(channels, choice) ? choice : undefined)
    ?? (panelTeam ? teamThreadId(panelTeam) : threads[0]?.id);
  const activeName = threads.find(thread => thread.id === active)?.name ??
    (active && Object.hasOwn(channels, active) ? channels[active as Channel] : undefined);
  useEffect(() => {
    if (visible && active) setVisited(previous => previous.includes(active) ? previous : [...previous, active]);
  }, [active, visible]);

  function picker(kind?: 'team') {
    return threads.filter(thread => !kind ? thread.kind !== 'team' : thread.kind === kind).map(thread =>
      <button className="row row-button" type="button" key={thread.id}
        aria-pressed={thread.id === active} onClick={() => setChoice(thread.id)}>{thread.name}</button>);
  }

  return <div className={visible ? office ? 'office-layout' : 'conversation-layout' : undefined} hidden={!visible}>
    <div key="navigation" className={office ? 'office-panel' : 'panel conversation-threads'}>
      {office ? office(active ?? '') : visible && <>
        <div className="panel-head"><h2>Threads</h2></div>
        {picker()}
        {(teams.length > 0 || setupPanel) && <div role="group" aria-label="Teams">
          <div className="panel-head"><h2>Teams</h2></div>
          {picker('team')}
          {setupPanel && !panelTeam && <button className="row row-button" type="button" onClick={setupPanel}>Set up Panel</button>}
        </div>}
      </>}
    </div>
    <section className={'panel chat' + (office ? ' office-chat' : '')} aria-labelledby="conversation-title">
      <div className="panel-head"><h2 id="conversation-title"><MessagesSquare size={19} />{activeName ?? 'Conversations'}</h2>
        {office && <button type="button" onClick={openFull}>Open full chat</button>}
      </div>
      {office && threads.length > 0 && <div className="thread-picker">
        <select aria-label="Choose a conversation" value={active ?? ''} onChange={event => setChoice(event.target.value)}>
          {(['employee', 'team', 'channel'] as const).map(kind => {
            const entries = threads.filter(thread => thread.kind === kind);
            return entries.length > 0 && <optgroup key={kind} label={{ employee: 'Employees', team: 'Teams', channel: 'Channels' }[kind]}>
              {entries.map(thread => <option key={thread.id} value={thread.id}>{thread.name}</option>)}
            </optgroup>;
          })}
          {active && !threads.some(thread => thread.id === active) && <option value={active}>{activeName}</option>}
        </select>
      </div>}
      {directoryError && <p className="error" role="status">{directoryError}</p>}
      {threads.filter(thread => thread.kind !== 'channel' && (visited.includes(thread.id) || (visible && thread.id === active))).map(thread => {
        const selected = thread.id === active;
        return <div className="chat-thread" key={thread.id} hidden={!selected}>
          {thread.kind === 'employee' ? <EmployeeChat employee={thread.employee} api={api} companyId={companyId} token={token}
            visible={visible && selected} />
            : thread.kind === 'team' && <TeamConversation team={thread.team} employees={employees}
              tasks={tasks.filter(task => task.team_id === thread.team.id)} activity={activity} api={api} openTask={openTask} />}
        </div>;
      })}
      {visible && active && Object.hasOwn(channels, active) && <ChannelConversation key={active} channel={active as Channel} employees={employees} api={api} />}
      {!active && <p className="empty">Add an AI employee to start a conversation.</p>}
    </section>
  </div>;
}

function ChannelConversation({ channel, employees, api }: { channel: Channel; employees: Employee[]; api: Api }) {
  const [thread, setThread] = useState<ChannelThread | null>();
  const [error, setError] = useState('');
  const refresh = useCallback(async (isCurrent: () => boolean) => {
    try {
      const result = await api<ChannelThread | null>('/' + channel);
      if (!isCurrent()) return;
      setThread(result);
      setError('');
    } catch {
      if (isCurrent()) setError('Channel conversation could not be refreshed.');
    }
  }, [api, channel]);
  useConversationRefresh(true, 4000, refresh);

  return <>
    <Transcript messages={uiMessages(thread?.messages ?? [])} employee={employees.find(person => person.id === thread?.employeeId)}
      empty={thread === undefined ? (error || 'Loading conversation…') : thread ? 'No channel messages yet.' : 'Conversation unavailable.'} />
    {thread && error && <p className="error" role="status">{error}</p>}
  </>;
}

function TeamConversation({ team, employees, tasks, activity, api, openTask }: {
  team: Team; employees: Employee[]; tasks: Task[]; activity: Activity[]; api: Api; openTask: (id: string) => void;
}) {
  const lead = employees.find(employee => employee.id === team.lead_employee_id);
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<Task[]>([]);
  const attempt = useRef<{ id: string; prompt: string } | undefined>(undefined);
  const entries = [...submitted.filter(task => !tasks.some(item => item.id === task.id)), ...tasks].reverse();

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lead || pending || !prompt.trim()) return;
    const text = prompt.trim();
    if (attempt.current?.prompt !== text) attempt.current = { id: crypto.randomUUID(), prompt: text };
    setPending(true);
    setError('');
    try {
      const task = await api<Task>('/tasks/background', 'POST', { ...attempt.current, teamId: team.id });
      setSubmitted(items => [task, ...items.filter(item => item.id !== task.id)].slice(0, 10));
      attempt.current = undefined;
      setPrompt('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The team could not accept this request.');
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="pad muted">{lead ? `Led by ${lead.name}` : 'Assign a lead in Teams to start sending work.'}</div>
    <ConversationLog label="Team requests">
      {entries.length ? entries.map(task => <MessageScroller.Item key={task.id} messageId={task.id}>
        <article className="pad">
          <p><strong>Request</strong> <small>{dateLabel(task.created_at)}</small></p>
          <ChatPart part={{ type: 'text', text: task.prompt }} streaming={false} />
          <p><strong>{employees.find(employee => employee.id === task.employee_id)?.name ?? 'Team lead'}</strong>
            {' · '}{task.status === 'succeeded' ? 'Completed' : task.status}</p>
          {activity.filter(event => event.kind === 'delegation' && event.task_id === task.id).map(event =>
            <span className="pill" key={event.id}>
              {employees.find(employee => employee.id === event.employee_id)?.name ?? 'Teammate'} · {event.status}
            </span>)}
          {task.result && <ChatPart part={{ type: 'text', text: task.result }} streaming={false} />}
          {task.error && <p className="error">{task.error}</p>}
          <button type="button" onClick={() => openTask(task.id)}>View task and delegations</button>
        </article>
      </MessageScroller.Item>) : <p className="empty">Send the team its first request.</p>}
    </ConversationLog>
    {error && <p className="error" role="alert">{error}</p>}
    <form className="chat-compose" onSubmit={send}>
      <textarea aria-label={'Message ' + team.name} placeholder={'Message ' + team.name}
        value={prompt} onChange={event => setPrompt(event.target.value)}
        maxLength={20000} rows={2} disabled={!lead || pending} required />
      <Button disabled={!lead || pending || !prompt.trim()}><Send size={15} /> {pending ? 'Sending…' : 'Send'}</Button>
    </form>
  </>;
}

function ConversationAvatar({ id }: { id: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 32, 32);
    drawAvatar((x, y, w, h, color) => {
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.fillRect(x, y, w, h);
    }, id, 0, 2);
  }, [id]);
  return <canvas className="thread-avatar" ref={canvas} width={32} height={32} aria-hidden="true" />;
}

function ConversationLog({ label, children }: { label: string; children: ReactNode }) {
  return <MessageScroller.Provider autoScroll>
    <MessageScroller.Root className="transcript">
      <MessageScroller.Viewport className="transcript-viewport" role="log" aria-label={label}>
        <MessageScroller.Content>{children}</MessageScroller.Content>
      </MessageScroller.Viewport>
      <MessageScroller.Button direction="end" className="chat-scroll-latest" aria-label="Scroll to latest"><ArrowDown size={16} /></MessageScroller.Button>
    </MessageScroller.Root>
  </MessageScroller.Provider>;
}

function Transcript({ messages, empty, employee, pending, streaming }: {
  messages: ChatMessage[]; empty: string; employee?: Employee; pending?: boolean; streaming?: boolean;
}) {
  return <ConversationLog label="Conversation messages">
      {messages.length ? messages.map((message, index) => <MessageScroller.Item key={message.id}
        messageId={message.id} scrollAnchor={message.role === 'user'}>
        <Message className="message">
          <MessageAvatar className="self-start rounded-lg">
            {message.role === 'assistant' && employee ? <ConversationAvatar id={employee.id} />
              : <span className="thread-avatar thread-initial" aria-hidden="true">{message.role === 'user' ? 'Y' : 'A'}</span>}
          </MessageAvatar>
          <MessageContent className="message-body">
            <MessageHeader className="message-meta">
              <strong>{message.role === 'user' ? 'You' : employee?.name ?? 'Employee'}</strong>
              {message.metadata?.createdAt && <time dateTime={message.metadata.createdAt}>{dateLabel(message.metadata.createdAt)}</time>}
            </MessageHeader>
            {message.parts.map((part, partIndex) => <ChatPart key={partIndex} part={part}
              streaming={Boolean(streaming && message.role === 'assistant' && index === messages.length - 1)} />)}
          </MessageContent>
        </Message>
      </MessageScroller.Item>) : <p className="empty">{empty}</p>}
      {pending && <p className="chat-working" role="status">{employee?.name ?? 'Employee'} is preparing a reply…</p>}
  </ConversationLog>;
}

function EmployeeChat({ employee, companyId, token, api, visible }: {
  employee: Employee; companyId: string; token: string; api: Api; visible: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const path = '/employees/' + employee.id + '/chat';
  const submitted = useRef<string | null>(null);
  const historyVersion = useRef(0);
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);
  const transport = useMemo(() => new DefaultChatTransport<ChatMessage>({
    api: '/api/agentops/companies/' + companyId + path + '/stream',
    headers: () => ({ Authorization: 'Bearer ' + tokenRef.current }),
    prepareSendMessagesRequest({ messages }) {
      const message = messages.at(-1)?.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
      return { body: { message } };
    },
  }), [companyId, path]);
  const { messages, setMessages, sendMessage, status, error, clearError } = useChat<ChatMessage>({
    id: companyId + ':' + employee.id, transport,
    onError() {
      const text = submitted.current;
      if (text) setDraft(current => current || text);
    },
  });
  const busy = status === 'submitted' || status === 'streaming';
  const refreshHistory = useCallback(async (isCurrent: () => boolean) => {
    const version = historyVersion.current;
    const canApply = () => isCurrent() && historyVersion.current === version && submitted.current === null;
    try {
      const saved = await api<SavedMessage[]>(path);
      if (!canApply()) return;
      setMessages(previous => {
        const next = uiMessages(saved);
        return previous.length === next.length && previous.every((message, i) => message.id === next[i].id &&
          JSON.stringify(message.parts) === JSON.stringify(next[i].parts)) ? previous : next;
      });
      setHistoryError('');
    } catch (error) {
      if (canApply()) setHistoryError(String(error));
    } finally {
      if (canApply()) setLoading(false);
    }
  }, [api, path, setMessages]);
  useConversationRefresh(visible && !busy, 4000, refreshHistory);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || busy || loading || submitted.current !== null) return;
    clearError();
    const text = draft.trim();
    submitted.current = text;
    historyVersion.current++;
    setDraft('');
    try {
      await sendMessage({ text, metadata: { createdAt: new Date().toISOString() } });
    } catch {
      setDraft(current => current || text);
    } finally {
      submitted.current = null;
    }
  }
  const sendError = error && ('statusCode' in error && error.statusCode === 409
    ? 'A reply is already running for this conversation. Your draft is ready to retry.'
    : 'The employee could not complete this reply.');
  return <>
    <Transcript employee={employee} messages={messages} pending={status === 'submitted'} streaming={status === 'streaming'}
      empty={loading ? 'Loading conversation…' : 'Start a conversation with ' + employee.name + '.'} />
    {(sendError || historyError) && <p className="error" role="alert">{sendError || historyError}</p>}
    <form className="chat-compose" onSubmit={send}>
      <textarea aria-label="Message" value={draft} onChange={event => setDraft(event.target.value)}
        placeholder={'Message ' + employee.name} required maxLength={20000} rows={2} />
      <Button disabled={busy || loading || !draft.trim()}><Send size={15} /> Send</Button>
    </form>
  </>;
}
