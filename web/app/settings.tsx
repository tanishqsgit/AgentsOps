'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, KeyRound, MessagesSquare, Plug, Search, Server } from 'lucide-react';
import { channelNames, type Api, type Employee } from './data';
import { Button } from './ui/button';

type Platform = keyof typeof channelNames;
type ChannelOption = { id: string; name: string; setup: boolean; managedAdapter: boolean };
type Channel = {
  platform: Platform; senderId: string; employeeId: string; botName: string;
  webhookPath: string; webhookUrl: string | null; source: 'environment' | 'workspace';
};
type WorkspaceSettings = {
  model: { id: string; custom: boolean; source: 'workspace' | 'environment' | 'missing' };
  connect: { configured: boolean; projectId: string | null };
  channels: Channel[];
  search: 'tavily' | 'brave' | 'tinyfish' | null;
  sandbox: boolean;
  channelCatalog: ChannelOption[];
};
type Inventory = {
  providers: string[];
  discovery: 'unlinked' | 'available' | 'unavailable';
  tools: { id: string; name: string; provider: string | null; description?: string; assignable: boolean }[];
};
const groups = [
  { id: 'services', label: 'Integrations', icon: Plug },
  { id: 'channels', label: 'Channels', icon: MessagesSquare },
  { id: 'models', label: 'Models', icon: KeyRound },
  { id: 'runtime', label: 'Runtime', icon: Server },
] as const;
const providerDocs = {
  telegram: 'https://core.telegram.org/bots/tutorial',
  slack: 'https://api.slack.com/apps',
  discord: 'https://discord.com/developers/applications',
  whatsapp: 'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks',
};
type Save = (request: () => Promise<unknown>, message: string, form?: HTMLFormElement) => void;

function external(href: string, label: string) {
  return <a href={href} target="_blank" rel="noreferrer" className="artifact-link">{label}<ExternalLink size={13} /></a>;
}

function SettingPanel({ title, status, children }: { title: string; status?: string; children: ReactNode }) {
  return <section className="panel">
    <div className="panel-head"><h2>{title}</h2>{status && <span className="pill">{status}</span>}</div>
    <div className="pad setting-body">{children}</div>
  </section>;
}

export function Settings({ employees, api, owner }: { employees: Employee[]; api: Api; owner: boolean }) {
  const [group, setGroup] = useState<(typeof groups)[number]['id']>('services');
  const [settings, setSettings] = useState<WorkspaceSettings>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [channelId, setChannelId] = useState('telegram');
  const [inventory, setInventory] = useState<Inventory>();

  useEffect(() => {
    if (!owner) return;
    let active = true;
    api<WorkspaceSettings>('/settings').then(value => { if (active) setSettings(value); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, owner]);

  const connectProject = settings?.connect.projectId;
  useEffect(() => {
    if (!owner || group !== 'services' || connectProject === undefined) return;
    let active = true;
    api<Inventory>('/settings/integrations').then(value => { if (active) setInventory(value); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, owner, group, connectProject]);

  const save: Save = async (request, message, form) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await request();
      form?.reset();
      setSettings(await api<WorkspaceSettings>('/settings'));
      setNotice(message);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };

  if (!owner) return <p className="panel empty">Only the company owner can manage workspace settings.</p>;
  return <>
    <div className="section-tabs" aria-label="Settings sections" role="group">
      {groups.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={group === id}
        onClick={() => { setGroup(id); setError(''); setNotice(''); }}><Icon size={16} />{label}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    {!settings ? <p className="empty">{error ? 'Settings unavailable.' : 'Loading settings…'}</p> : <>
      {group === 'models' && <ModelSettings key={settings.model.id} model={settings.model} pending={pending} api={api} save={save} />}
      {group === 'runtime' &&
        <SettingPanel title="Service configuration">
          <dl className="setting-meta"><div><dt>Execution</dt><dd>AgentOps (self-hosted)</dd></div>
            <div><dt>Authentication</dt><dd>Supabase Auth</dd></div>
            <div><dt>Runtime storage</dt><dd>PostgreSQL</dd></div></dl>
          <p className="muted">Auth, database, and public ingress are set in the Docker service environment.</p>
        </SettingPanel>}
      {group === 'channels' && <div className="columns">
        <SettingPanel title="Channel catalog">
          <label className="form">Channel<select value={channelId} onChange={event => setChannelId(event.target.value)}>
            <optgroup label="Connect in AgentOps">{settings.channelCatalog.filter(item => item.setup).map(item =>
              <option value={item.id} key={item.id}>{item.name}{settings.channels.some(connection => connection.platform === item.id) ? ' (linked)' : ''}</option>)}</optgroup>
            <optgroup label="Adapter available, setup pending">{settings.channelCatalog.filter(item => !item.setup).map(item =>
              <option value={item.id} key={item.id}>{item.name}</option>)}</optgroup>
          </select></label>
          {!settings.channelCatalog.find(item => item.id === channelId)?.setup && <p className="muted">
            This adapter is listed in the channel catalog. Its setup and delivery are pending in AgentOps.
          </p>}
        </SettingPanel>
        {settings.channelCatalog.some(item => item.id === channelId && item.setup) &&
          <ChannelSettings key={channelId} platform={channelId as Platform} companyChannel={settings.channels.find(item => item.platform === channelId)}
            employees={employees} pending={pending} api={api} save={save} />}
      </div>}
      {group === 'services' && <SettingPanel title="Python sandbox" status={settings.sandbox ? 'Configured' : 'Setup required'}>
        <p className="muted">Connect E2B and grant Python sandbox to an employee in People. Each call uses a temporary environment.</p>
        <form className="inline-form" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          save(() => api('/settings/sandbox', 'PUT', { apiKey: new FormData(form).get('apiKey') }), 'Sandbox settings saved.', form);
        }}>
          <label>E2B API key<input name="apiKey" type="password" required autoComplete="new-password" /></label>
          <Button disabled={pending}>Save sandbox provider</Button>
          {settings.sandbox && <button type="button" disabled={pending}
            onClick={() => save(() => api('/settings/sandbox', 'PUT', null), 'Sandbox provider removed.')}>Disconnect</button>}
        </form>
      </SettingPanel>}
      {group === 'services' && <SettingPanel title="Web search" status={settings.search ? 'Configured' : 'Setup required'}>
        <p className="muted">Save a provider key, then grant Web search in People. TinyFish also supports Fetch web page.</p>
        <form className="inline-form" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          save(() => api('/settings/search', 'PUT', { provider: data.get('provider'), apiKey: data.get('apiKey') }), 'Search settings saved.', form);
        }}>
          <label>Provider<select name="provider" defaultValue={settings.search ?? 'tavily'}><option value="tavily">Tavily</option><option value="brave">Brave Search</option><option value="tinyfish">TinyFish (TinySearch)</option></select></label>
          <label>Search API key<input name="apiKey" type="password" required autoComplete="new-password" /></label>
          <Button disabled={pending}>Save search provider</Button>
          {settings.search && <button type="button" disabled={pending} onClick={() => save(() => api('/settings/search', 'PUT', null), 'Search provider removed.')}>Disconnect</button>}
        </form>
      </SettingPanel>}
      {group === 'services' && <div className="integration-layout">
        <IntegrationCatalog inventory={inventory} onRefresh={() => save(async () => {
          const result = await api<Inventory>('/settings/integrations?refresh=true');
          setInventory(result);
          if (result.discovery === 'unavailable') throw new Error('Integration hub discovery is unavailable for this project.');
        }, 'Integrations refreshed.')} refreshing={pending} />
        <SettingPanel title="Integration hub" status={settings.connect.configured ? 'Project saved' : 'Optional'}>
          <p className="muted">Link a workspace project to discover tools from your connected accounts. Authorize and manage accounts in your integration hub.</p>
          <form className="form" onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = new FormData(form);
            save(async () => {
              await api('/settings/connect', 'PUT', { projectId: fields.get('projectId'), accessToken: fields.get('accessToken') });
              setInventory(await api<Inventory>('/settings/integrations'));
            }, 'Integration hub project saved.', form);
          }}>
            <label>Project ID<input name="projectId" required defaultValue={settings.connect.projectId ?? ''} /></label>
            <label>Platform access token<input name="accessToken" type="password" autoComplete="new-password" required /></label>
            <div className="actions"><Button disabled={pending}>Verify and save project</Button>
              {settings.connect.configured && <button type="button" disabled={pending} onClick={() => {
                save(async () => { await api('/settings/connect', 'PUT', null); setInventory(undefined); }, 'Connect project removed.');
              }}>Disconnect</button>}</div>
          </form>
        </SettingPanel>
      </div>}
    </>}
  </>;
}

function ModelSettings({ model, pending, api, save }: { model: WorkspaceSettings['model']; pending: boolean; api: Api; save: Save }) {
  const separator = model.id.indexOf('/');
  const [provider, setProvider] = useState(model.id.slice(0, separator));
  const [modelId, setModelId] = useState(model.id.slice(separator + 1));
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api<typeof providers>('/settings/models').then(items => { if (active) setProviders(items); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;
    api<string[]>('/settings/models?provider=' + encodeURIComponent(provider)).then(items => { if (active) setModels(items); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, provider]);

  return <SettingPanel title="Workspace default model" status={{
    workspace: 'Workspace key', environment: 'Server credentials', missing: 'Key required',
  }[model.source]}>
    <dl className="setting-meta"><div><dt>Active model</dt><dd><code>{model.id}</code></dd></div></dl>
    {error && <p className="error" role="alert">{error}</p>}
    <form className="form" onSubmit={event => {
      event.preventDefault();
      const form = event.currentTarget;
      const apiKey = String(new FormData(form).get('apiKey') ?? '').trim();
      save(async () => {
        await api('/settings/models/default', 'PUT', { modelId: provider + '/' + modelId, apiKey: apiKey || null });
        form.reset();
      }, 'Workspace model verified and saved.');
    }}>
      <label>Provider<select value={provider} onChange={event => { setProvider(event.target.value); setModelId(''); setModels([]); setError(''); }}>
        {!providers.some(item => item.id === provider) && <option value={provider}>{provider}</option>}
        {providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Model ID<input value={modelId} onChange={event => setModelId(event.target.value)} list="workspace-models" required /></label>
      <datalist id="workspace-models">{models.map(id => <option value={id} key={id} />)}</datalist>
      <label>Provider API key<input name="apiKey" type="password" autoComplete="new-password" /></label>
      <p className="muted">Leave the key empty to use the provider credentials configured on the server. Verification sends a short test message.</p>
      <div className="actions"><Button disabled={pending}>Verify and save model</Button>
        {model.custom && <button type="button" disabled={pending} onClick={() =>
          save(() => api('/settings/models/default', 'PUT', null), 'Deployment model restored.')}>Use deployment model</button>}</div>
    </form>
  </SettingPanel>;
}

const providerNames: Record<string, string> = {
  'google-mail': 'Gmail', 'twitter-v2': 'X / Twitter', github: 'GitHub', 'one-drive': 'OneDrive',
  openai: 'OpenAI', workos: 'WorkOS',
};

function IntegrationCatalog({ inventory, onRefresh, refreshing }: {
  inventory?: Inventory; onRefresh: () => void; refreshing: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>();
  const search = query.trim().toLowerCase();
  const providers = [...new Set([...(inventory?.providers ?? []), ...(inventory?.tools.some(tool => !tool.provider) ? ['other'] : [])])];
  const providerName = (id: string) => providerNames[id] ?? (id === 'other' ? 'Other discovered tools' :
    id.split('-').map(word => word[0]?.toUpperCase() + word.slice(1)).join(' '));
  const matching = providers.filter(id => (providerName(id) + ' ' + id).toLowerCase().includes(search));
  const tools = inventory?.tools.filter(tool => (tool.provider ?? 'other') === selected) ?? [];
  return <section className="panel">
    <div className="panel-head"><h2>Integration catalog</h2>
      {inventory && inventory.discovery !== 'unlinked' && <button disabled={refreshing} onClick={onRefresh}>Refresh</button>}
    </div>
    <div className="pad setting-body">
      {inventory?.discovery === 'unavailable' && <p className="error">Live tool discovery is unavailable. Check the linked project or try again.</p>}
      <label className="integration-search"><Search size={16} /><input type="search" aria-label="Search integrations"
        placeholder="Search integrations" value={query} onChange={event => { setQuery(event.target.value); setSelected(undefined); }} /></label>
      {selected && <section className="integration-detail">
        <div className="integration-detail-heading"><h3>{providerName(selected)}</h3><button onClick={() => setSelected(undefined)}>Close details</button></div>
        {tools.length ? <ul className="settings-list">{tools.map(tool => <li key={tool.id}>
          <div><strong>{tool.name}</strong>{tool.description && <small>{tool.description}</small>}</div>
          <span className={'pill ' + (tool.assignable ? 'succeeded' : '')}>{tool.assignable ? 'Assignable in People' : 'Discovery only'}</span>
        </li>)}</ul> : <p className="muted">{inventory?.discovery === 'unlinked' ?
          'Link an integration project to discover available tools.' : 'No tools discovered for this provider in the linked project.'}</p>}
      </section>}
      <div className="provider-grid">{matching.map(id => <button key={id} aria-pressed={selected === id} onClick={() => setSelected(id)}>
        <Plug size={16} /><strong>{providerName(id)}</strong>
      </button>)}</div>
      {!matching.length && <p className="muted">{inventory ? 'No matching integrations.' : 'Loading integrations…'}</p>}
    </div>
  </section>;
}

function ChannelSettings({ companyChannel, platform, employees, pending, api, save }: {
  companyChannel?: Channel; platform: Platform; employees: Employee[]; pending: boolean; api: Api; save: Save;
}) {
  const path = '/settings/channels/' + platform;
  const telegram = platform === 'telegram';
  const discord = platform === 'discord';
  const whatsapp = platform === 'whatsapp';
  const name = channelNames[platform];
  const config = companyChannel;
  const status = config?.source === 'environment' ? 'Server-managed' : config?.webhookUrl ? 'Webhook registered'
    : config ? 'Bot verified' : 'Setup required';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    save(() => api(path, 'PUT', { platform, ...Object.fromEntries(new FormData(form)) }), name + ' bot verified and linked.', form);
  }

  return <SettingPanel title={name} status={status}>
    <p className="muted">{telegram ? 'Link a BotFather bot and one Telegram user to an employee.'
      : discord ? 'Link a Discord app and one Discord user to an employee for private slash commands.'
        : whatsapp ? 'Link a WhatsApp Business phone number and one sender to an employee.'
        : 'Install a Slack bot in a workspace and link one Slack user to an employee.'}</p>
    {external(providerDocs[platform], name + ' setup guide')}
    {config && <dl className="setting-meta">
      <div><dt>Bot</dt><dd>{config.botName}</dd></div>
      <div><dt>Employee</dt><dd>{employees.find(employee => employee.id === config.employeeId)?.name ?? config.employeeId}</dd></div>
      <div><dt>Webhook</dt><dd><code>{config.webhookUrl ?? config.webhookPath}</code></dd></div>
    </dl>}
    {config?.source !== 'environment' && <details className="settings-details" open={!config ? true : undefined}>
      <summary>{config ? 'Replace credentials or binding' : 'Connect bot'}</summary>
      {employees.length ? <form key={config?.employeeId + ':' + config?.senderId} className="form" onSubmit={submit}>
        <label>{whatsapp ? 'Meta access token' : 'Bot token'}<input name="botToken" type="password" autoComplete="new-password" required /></label>
        {!telegram && <label>{discord ? 'Discord application public key' : whatsapp ? 'Meta app secret' : 'Slack signing secret'}<input name="signingSecret" type="password" autoComplete="new-password" required /></label>}
        {whatsapp && <>
          <label>Business phone number ID<input name="phoneNumberId" inputMode="numeric" required /></label>
          <label>Webhook verification token<input name="verifyToken" type="password" minLength={12} autoComplete="new-password" required /></label>
        </>}
        <label>{telegram ? 'Telegram sender ID' : discord ? 'Discord user ID' : whatsapp ? 'WhatsApp sender ID (digits only for a phone number)' : 'Slack member ID'}<input name="senderId" defaultValue={config?.senderId}
          inputMode={telegram ? 'numeric' : 'text'} required /></label>
        <label>Assigned employee<select name="employeeId" defaultValue={config?.employeeId} required>
          {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select></label>
        <Button disabled={pending}>Verify and save bot</Button>
      </form> : <p className="muted">Add an employee in People first.</p>}
    </details>}
    {config?.source === 'workspace' && <>
      {telegram ? <form className="form" onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const origin = new FormData(form).get('origin');
        save(() => api(path + '/register', 'POST', { origin }), 'Telegram registered the webhook.', form);
      }}><label>Public AgentOps HTTPS origin<input name="origin" type="url" placeholder="https://agentops.example.com" required /></label>
        <Button disabled={pending}>Register Telegram webhook</Button></form>
        : discord ? <>
          <p className="muted">Set the public service origin plus the webhook path as the Discord Interactions Endpoint URL.
            Install the app to a shared server, then use <code>/agentops</code> in a direct message with the bot.</p>
          <button type="button" disabled={pending} onClick={() =>
            save(() => api(path + '/register', 'POST'), 'Discord registered the private slash command.')}>Register slash command</button>
        </>
        : whatsapp ? <p className="muted">Set the public service origin plus the webhook path as the Meta callback URL. Enter the same verification token and subscribe to the <code>messages</code> field.</p>
        : <p className="muted">Set the public service origin plus the webhook path as the Slack Events Request URL. Subscribe to <code>message.im</code> and grant <code>im:history</code> and <code>chat:write</code>.</p>}
      <button type="button" disabled={pending} onClick={() => save(() => api(path, 'DELETE'), name + ' disconnected from AgentOps.')}>Disconnect bot</button>
    </>}
  </SettingPanel>;
}
