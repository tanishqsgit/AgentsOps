import { PROVIDERS, tools as connectTools, type ToolsOptions } from '@mastra/connect';
import { db } from '../db.ts';

import type { SearchProvider } from './search.ts';

type Credentials = {
  sandbox_api_key: string | null;
  search_provider: SearchProvider | null;
  search_api_key: string | null;
  mistral_api_key: string | null;
  model_id: string | null;
  model_api_key: string | null;
  connect_project_id: string | null;
  connect_access_token: string | null;
};
const empty: Credentials = { sandbox_api_key: null, search_provider: null, search_api_key: null, mistral_api_key: null, model_id: null, model_api_key: null, connect_project_id: null, connect_access_token: null };

export async function credentials(companyId: string) {
  const { rows: [row] } = await db.query<Credentials>(
    'select sandbox_api_key, search_provider, search_api_key, mistral_api_key, model_id, model_api_key, connect_project_id, connect_access_token from agentops.company_settings where company_id = $1',
    [companyId],
  );
  return row ?? empty;
}

// Only these read operations can run through the current task and channel entry points.
export const connectCatalog = {
  github_get_repository: { provider: 'github', name: 'Read repository details' },
  github_list_issues: { provider: 'github', name: 'List issues' },
  github_get_issue: { provider: 'github', name: 'Read an issue' },
  github_list_pull_requests: { provider: 'github', name: 'List pull requests' },
  linear_list_issues: { provider: 'linear', name: 'List Linear issues' },
  linear_get_issue: { provider: 'linear', name: 'Read a Linear issue' },
  notion_search_pages: { provider: 'notion', name: 'Search Notion pages' },
  notion_get_page_as_markdown: { provider: 'notion', name: 'Read a Notion page' },
  google_mail_list_messages: { provider: 'google-mail', name: 'List Gmail messages' },
  google_mail_get_message: { provider: 'google-mail', name: 'Read a Gmail message' },
} as const;

const providers = [...new Set(Object.values(connectCatalog).map(tool => tool.provider))];
const providerIds = PROVIDERS.map(provider => provider.integrationId).sort();
const catalogProviders = [...providerIds].sort((a, b) => b.length - a.length);

type Resolver = ReturnType<typeof connectTools>;
const resolvers = new Map<string, { projectId: string; token: string; runtime: Resolver; inventory: Resolver }>();

type ConnectConfig = Pick<Credentials, 'connect_project_id' | 'connect_access_token'>;

function connect(companyId: string, config: ConnectConfig) {
  if (!config.connect_project_id || !config.connect_access_token) {
    resolvers.delete(companyId);
    return;
  }
  let cached = resolvers.get(companyId);
  if (!cached || cached.projectId !== config.connect_project_id || cached.token !== config.connect_access_token) {
    const options: ToolsOptions = {
      projectId: config.connect_project_id, resourceId: companyId, connectPrompt: false,
      client: {
        accessToken: config.connect_access_token,
        fetch: (input, init) => fetch(input, { ...init,
          signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
        }),
      },
    };
    cached = {
      projectId: config.connect_project_id,
      token: config.connect_access_token,
      runtime: connectTools({ ...options, providers, allowTools: Object.keys(connectCatalog) }),
      inventory: connectTools(options),
    };
    resolvers.set(companyId, cached);
  }
  return cached;
}

export async function discoverTools(companyId: string, config: ConnectConfig, refresh = false) {
  const runtime = connect(companyId, config)?.runtime;
  if (!runtime) return {};
  const results = refresh ? await runtime.refresh() : await runtime();
  return Object.fromEntries(Object.entries(results).filter(([id]) => Object.hasOwn(connectCatalog, id)));
}

export async function integrationInventory(companyId: string, config: ConnectConfig, refresh: boolean) {
  const inventory = connect(companyId, config)?.inventory;
  const catalog = connectCatalog as Record<string, { name: string; provider: string }>;
  const tools = inventory ? await (refresh ? inventory.refresh() : inventory()).catch(() => null) : {};
  return {
    providers: providerIds,
    discovery: !inventory ? 'unlinked' : tools ? 'available' : 'unavailable',
    tools: Object.entries(tools ?? {}).map(([id, tool]) => {
      const provider = catalog[id]?.provider ??
        catalogProviders.find(candidate => id.startsWith(candidate.replaceAll('-', '_') + '_')) ?? null;
      const description = 'description' in tool && typeof tool.description === 'string' ? tool.description : undefined;
      return { id, provider, name: catalog[id]?.name ?? id, description, assignable: Object.hasOwn(catalog, id) };
    }),
  };
}
