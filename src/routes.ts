import { searchProviders } from './mastra/search.ts';
import { createEventedWorkflow, createStep, createWorkflow } from '@mastra/core/workflows';
import { createHash } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { db } from './db.ts';
import { deleteKnowledge, KnowledgeInputError, knowledgeToolId, listKnowledge, readKnowledgeFile, retrieveKnowledge, uploadKnowledge } from './knowledge.ts';
import { employeeModel, generateEmployee, releaseBrief, taskOutputFormat, type EmployeeProfile } from './mastra/employee.ts';
import { apiConversation, ConversationBusyError, converse, history, streamConversation } from './mastra/conversation.ts';
import { releaseReview, reviewState } from './mastra/review.ts';
import { telegram } from './mastra/telegram.ts';
import { employeeToolIds } from './mastra/tools.ts';
import { connectCatalog, credentials, discoverTools, integrationInventory, modalSandboxCredentials } from './mastra/integrations.ts';
import { modalCredentialsSchema } from './mastra/sandbox.ts';
import { configuredModel, modelProviders, providerModelIds, verifyModel } from './mastra/models.ts';
import { channelCatalog, channelConversation, channelInput, dispatchChannel, loadChannel, platformSchema, publicChannel, type Platform,
  registerDiscordCommand, registerTelegramWebhook, verifyChannel, webhookPath } from './mastra/company-channels.ts';

const prefix = '/agentops/v1';
const companyPath = '/companies/:companyId';
const uuid = z.uuid();
const name = z.string().trim().min(1).max(120);
const content = z.string().trim().min(1).max(20_000);
const employeeInput = z.object({ name, role: name, instructions: content, toolIds: employeeToolIds.optional() });
const teamInput = z.object({
  name,
  leadEmployeeId: uuid.nullish(),
  employeeIds: z.array(uuid).min(2).max(6),
}).refine(
  team => new Set(team.employeeIds).size === team.employeeIds.length && (!team.leadEmployeeId || team.employeeIds.includes(team.leadEmployeeId)),
  'List distinct employees and include the lead if one is assigned.',
);
const taskFields = {
  id: uuid,
  prompt: content,
  outputFormat: taskOutputFormat.default('text'),
};
const taskInput = z.union([
  z.strictObject({ ...taskFields, employeeId: uuid }),
  z.strictObject({ ...taskFields, teamId: uuid }),
]);

type RouteOptions = Parameters<typeof registerApiRoute>[1];
type RouteContext = Parameters<NonNullable<RouteOptions['handler']>>[0];
type Team = {
  id: string;
  lead_employee_id: string | null;
  employee_ids: string[];
};
type Task = {
  id: string;
  company_id: string;
  employee_id: string;
  team_id: string | null;
  prompt: string;
  output_format: z.infer<typeof taskOutputFormat>;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result_data: unknown;
};

class RequestError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 409) {
    super(message);
  }
}

function userId(c: RouteContext) {
  const user = c.get('requestContext').get('user') as { id?: string } | undefined;
  if (!user?.id) throw new RequestError('Sign in to AgentOps.', 401);
  return user.id;
}

async function rememberUser(c: RouteContext) {
  const user = c.get('requestContext').get('user') as { id?: string; email?: string } | undefined;
  if (!user?.id) throw new RequestError('Sign in to AgentOps.', 401);
  await db.query(`insert into agentops.users (id, email, email_confirmed_at) values ($1, $2, now())
    on conflict (id) do update set email = excluded.email, email_confirmed_at = now()
    where agentops.users.email is distinct from excluded.email or agentops.users.email_confirmed_at is null`,
  [user.id, user.email ?? null]);
}

async function accessCompany(c: RouteContext, ownerOnly = false) {
  const id = uuid.parse(c.req.param('companyId'));
  const { rowCount } = await db.query(
    `select id from agentops.companies c where id = $1 and (owner_id = $2 or (
       not $3::boolean and exists (select 1 from agentops.company_members m where m.company_id = c.id and m.user_id = $2)
     ))`,
    [id, userId(c), ownerOnly],
  );
  if (!rowCount) throw new RequestError('Company not found.', 404);
  return id;
}

const ownedCompany = (c: RouteContext) => accessCompany(c, true);

async function taskForCompany(companyId: string, taskId: string) {
  const { rows: [task] } = await db.query<Task>(
    'select * from agentops.tasks where company_id = $1 and id = $2', [companyId, taskId],
  );
  if (!task) throw new RequestError('Task not found.', 404);
  return task;
}

async function withReviewLock<T>(taskId: string, review: () => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('begin');
    const { rows: [lock] } = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired', [taskId],
    );
    if (!lock.acquired) throw new RequestError('A review operation is already in progress.', 409);
    const result = await review();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function readBody<T extends z.ZodType>(c: RouteContext, schema: T): Promise<z.output<T>> {
  const body = await c.req.json().catch(() => {
    throw new RequestError('Expected a JSON request body.', 400);
  });
  return schema.parse(body);
}

function route(path: string, method: RouteOptions['method'], handler: NonNullable<RouteOptions['handler']>) {
  return registerApiRoute(prefix + path, {
    method,
    requiresAuth: true,
    handler: async (c, next) => {
      try {
        if (path === '/companies') await rememberUser(c);
        return await handler(c, next);
      } catch (error) {
        if (error instanceof ConversationBusyError) return c.json({ error: error.message }, 409);
        if (error instanceof RequestError) return c.json({ error: error.message }, error.status);
        if (error instanceof KnowledgeInputError) return c.json({ error: error.message }, 400);
        if (error instanceof z.ZodError) return c.json({ error: 'Invalid input.', issues: error.issues }, 400);
        console.error('AgentOps request failed:', method, path, error instanceof Error ? error.name : 'Unknown error');
        return c.json({ error: 'AgentOps could not complete the request.' }, 500);
      }
    },
  });
}

async function loadRoster(companyId: string, employeeIds: string[]) {
  const { rows } = await db.query<EmployeeProfile>(
    'select * from agentops.employees where company_id = $1 and id = any($2::uuid[])',
    [companyId, employeeIds],
  );
  if (rows.length !== employeeIds.length) throw new RequestError('Employee not found in this company.', 404);
  return rows;
}

async function runEmployee(employee: EmployeeProfile, task: Task, teammates: EmployeeProfile[], extended: boolean, mastra: import('@mastra/core/mastra').Mastra) {
  let result: Awaited<ReturnType<typeof generateEmployee>> | undefined;
  let failure: string | null = null;
  try {
    result = await generateEmployee(employee, task, task.team_id ? {
      teammates,
      delegation: {
        hookErrorStrategy: 'throw',
        enableResultReferences: true,
        async onDelegationStart({ primitiveId, toolCallId, prompt }) {
          await db.query(
            `insert into agentops.task_delegations (task_id, tool_call_id, employee_id, prompt)
             values ($1, $2, $3, $4)`,
            [task.id, toolCallId, primitiveId, prompt],
          );
        },
        async onDelegationComplete({ toolCallId, success, result }) {
          await db.query(
            `update agentops.task_delegations
             set status = $3, result = $4, finished_at = clock_timestamp()
             where task_id = $1 and tool_call_id = $2 and status = 'running'`,
            [task.id, toolCallId, success ? 'succeeded' : 'failed', result.text || null],
          );
        },
      },
    } : undefined, extended, mastra);
  } catch (error) {
    console.error('Mastra run failed:', task.id, error instanceof Error ? error.name : 'Unknown error');
    failure = 'The model did not complete the task. Check the service logs and retry with a new task ID.';
  }

  const { rows: [updated] } = await db.query<Task>(
    `with unfinished_delegations as (
       update agentops.task_delegations set status = 'failed', finished_at = now()
       where task_id = $1 and status = 'running'
     )
     update agentops.tasks
     set status = $2, result = $3, result_data = $4, error = $5, finished_at = now()
     where id = $1 returning *`,
    [task.id, failure ? 'failed' : 'succeeded', result?.text, result?.data, failure],
  );
  return updated;
}

async function submitTask(companyId: string, input: z.infer<typeof taskInput>, mastra: import('@mastra/core/mastra').Mastra, mode: 'sync' | 'queue' | 'worker' = 'sync') {
  const teamId = 'teamId' in input ? input.teamId : null;
  const selectedEmployeeId = 'employeeId' in input ? input.employeeId : null;
  const existingAttempt = async () => {
    const { rows: [existing] } = await db.query<Task>(
      'select * from agentops.tasks where company_id = $1 and id = $2',
      [companyId, input.id],
    );
    if (existing && (existing.team_id !== teamId || (!teamId && existing.employee_id !== selectedEmployeeId)
      || existing.prompt !== input.prompt || existing.output_format !== input.outputFormat)) {
      throw new RequestError('Task ID is already in use.', 409);
    }
    return existing;
  };
  const existing = await existingAttempt();
  if (existing && (existing.status !== 'queued' || mode !== 'worker')) return { task: existing, created: false };
  if (!existing && mode === 'worker') throw new RequestError('Queued task no longer exists.', 404);

  const { rows: [team] } = teamId ? await db.query<Team>(
    'select * from agentops.teams where company_id = $1 and id = $2',
    [companyId, teamId],
  ) : { rows: [] };
  if (teamId && !team) throw new RequestError('Team not found.', 404);
  if (team && !team.lead_employee_id) throw new RequestError('Assign a lead before sending a task to this team.', 409);

  const employeeId = team?.lead_employee_id ?? selectedEmployeeId!;
  const roster = await loadRoster(companyId, team?.employee_ids ?? [employeeId]);
  const employee = roster.find(member => member.id === employeeId);
  if (!employee) throw new RequestError('Team lead not found.', 404);

  const { rows: [task] } = existing
    ? await db.query<Task>(
      "update agentops.tasks set status = 'running', employee_id = $3 where id = $1 and company_id = $2 and status = 'queued' returning *",
      [input.id, companyId, employeeId],
    )
    : await db.query<Task>(
      `insert into agentops.tasks (id, company_id, employee_id, team_id, prompt, output_format, status)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing returning *`,
      [input.id, companyId, employeeId, teamId, input.prompt, input.outputFormat, mode === 'queue' ? 'queued' : 'running'],
    );
  if (task) return {
    task: mode === 'queue' ? task : await runEmployee(employee, task, roster.filter(member => member.id !== employeeId), mode === 'worker', mastra), created: true,
  };

  const concurrent = await existingAttempt();
  if (!concurrent) throw new RequestError('Task ID is already in use.', 409);
  return { task: concurrent, created: false };
}

function scheduledTaskId(companyId: string, runId: string) {
  const id = uuid.safeParse(runId);
  if (id.success) return id.data;
  const hash = createHash('sha256').update(companyId + ':' + runId).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const runScheduledTask = createStep({
  id: 'run-assigned-task',
  inputSchema: z.object({ companyId: uuid, task: taskInput }),
  outputSchema: z.object({ taskId: uuid, status: z.string() }),
  execute: async ({ inputData, runId, mastra }) => {
    if (!runId) throw new Error('Scheduled execution is missing its run ID.');
    const { task } = await submitTask(inputData.companyId, { ...inputData.task, id: scheduledTaskId(inputData.companyId, runId) }, mastra);
    if (task.status === 'succeeded' && task.output_format === 'release_brief' && !await reviewState(task.id)) {
      const review = await releaseReview.createRun({ runId: task.id, resourceId: inputData.companyId });
      await review.start({ inputData: releaseBrief.parse(task.result_data) });
    }
    return { taskId: task.id, status: task.status };
  },
});

export const scheduledTask = createWorkflow({
  id: 'scheduled-task', inputSchema: runScheduledTask.inputSchema, outputSchema: runScheduledTask.outputSchema,
}).then(runScheduledTask).commit();

const runBackgroundTask = createStep({
  id: 'execute-queued-task',
  inputSchema: z.object({ companyId: uuid, task: taskInput }),
  outputSchema: runScheduledTask.outputSchema,
  execute: async ({ inputData: { companyId, task: input }, mastra }) => {
    try {
      const { task } = await submitTask(companyId, input, mastra, 'worker');
      return { taskId: task.id, status: task.status };
    } catch (error) {
      await failQueuedTask(companyId, input.id, error instanceof RequestError ? error.message : 'The worker could not start this task.');
      throw error;
    }
  },
});

export const backgroundTask = createEventedWorkflow({
  id: 'background-task', inputSchema: runBackgroundTask.inputSchema, outputSchema: runBackgroundTask.outputSchema,
}).then(runBackgroundTask).commit();

async function failQueuedTask(companyId: string, taskId: string, error: string) {
  await db.query("update agentops.tasks set status = 'failed', error = $3, finished_at = now() where id = $1 and company_id = $2 and status = 'queued'",
    [taskId, companyId, error]);
}

async function scheduleForCompany(c: RouteContext) {
  const companyId = await ownedCompany(c);
  const schedules = c.get('mastra').schedules;
  const schedule = await schedules.get(c.req.param('scheduleId') ?? '');
  if (!schedule || schedule.workflowId !== scheduledTask.id || schedule.resourceId !== companyId) {
    throw new RequestError('Schedule not found.', 404);
  }
  return { schedules, schedule, companyId };
}

export const routes = [
  registerApiRoute(prefix + '/channel-webhooks/:companyId/whatsapp', {
    method: 'GET', requiresAuth: false,
    createHandler: async ({ mastra }) => async c => {
      const company = uuid.safeParse(c.req.param('companyId'));
      const channel = company.success && await loadChannel(company.data, 'whatsapp');
      return channel ? dispatchChannel(channel, c.req.raw, mastra) : c.notFound();
    },
  }),
  registerApiRoute(prefix + '/channel-webhooks/:companyId/:platform', {
    method: 'POST', requiresAuth: false,
    createHandler: async ({ mastra }) => async c => {
      const company = uuid.safeParse(c.req.param('companyId'));
      const platform = platformSchema.safeParse(c.req.param('platform'));
      if (!company.success || !platform.success) return c.notFound();
      const channel = await loadChannel(company.data, platform.data);
      if (!channel) return c.notFound();
      if (platform.data === 'slack') {
        const envelope = await c.req.raw.clone().json().catch(() => null);
        if (envelope?.team_id && envelope.team_id !== channel.installation_id.split(':')[0]) return c.notFound();
      }
      return dispatchChannel(channel, c.req.raw, mastra);
    },
  }),
  registerApiRoute('/healthz', {
    method: 'GET',
    requiresAuth: false,
    handler: async c => {
      try {
        const { rows: [schema] } = await db.query(
          `select to_regclass('agentops.company_settings') is not null
           and to_regclass('agentops.knowledge_sources') is not null
           and to_regclass('agentops.knowledge_chunks') is not null
           and (select count(*) from pg_attribute
                where attrelid = to_regclass('agentops.company_settings') and not attisdropped
                  and attname in ('sandbox_modal_token_id', 'sandbox_modal_token_secret')) = 2 as ready`,
        );
        if (!schema?.ready) return c.json({ status: 'unavailable' }, 503);
        return c.json({ status: 'ok' });
      } catch {
        return c.json({ status: 'unavailable' }, 503);
      }
    },
  }),
  route('/companies', 'POST', async c => {
    const input = await readBody(c, z.object({ name }));
    const { rows: [company] } = await db.query(
      'insert into agentops.companies (owner_id, name) values ($1, $2) returning *',
      [userId(c), input.name],
    );
    return c.json(company, 201);
  }),
  route('/companies', 'GET', async c => {
    const { rows } = await db.query(
      `select c.*, case when c.owner_id = $1 then 'owner' else 'member' end as access
       from agentops.companies c where c.owner_id = $1 or exists (
         select 1 from agentops.company_members m where m.company_id = c.id and m.user_id = $1
       ) order by c.created_at desc`,
      [userId(c)],
    );
    return c.json(rows);
  }),
  route(companyPath + '/employees', 'POST', async c => {
    const companyId = await ownedCompany(c);
    const input = await readBody(c, employeeInput);
    const { rows: [employee] } = await db.query(
      `insert into agentops.employees (company_id, name, role, instructions, tool_ids)
       values ($1, $2, $3, $4, $5) returning *`,
      [companyId, input.name, input.role, input.instructions, input.toolIds ?? []],
    );
    return c.json(employee, 201);
  }),
  route(companyPath + '/employees', 'GET', async c => {
    const companyId = await accessCompany(c);
    const { rows } = await db.query(
      'select * from agentops.employees where company_id = $1 order by name, id',
      [companyId],
    );
    return c.json(rows);
  }),
  route(companyPath + '/tools', 'GET', async c => {
    const companyId = await accessCompany(c);
    const config = await credentials(companyId);
    const tools = await discoverTools(companyId, config).catch(() => ({}));
    return c.json([
      { id: 'feedback-audit', name: 'Feedback audit', provider: 'agentops' },
      { id: knowledgeToolId, name: 'Search company knowledge', provider: 'agentops' },
      ...(modalSandboxCredentials(config) ? [{ id: 'python-sandbox', name: 'Python sandbox', provider: 'modal' }] : []),
      ...(config.search_provider ? [{ id: 'web-search', name: 'Web search', provider: config.search_provider }] : []),
      ...(config.search_provider === 'tinyfish' ? [{ id: 'fetch-web-page', name: 'Fetch web page', provider: 'tinyfish' }] : []),
      ...Object.entries(connectCatalog).filter(([id]) => Object.hasOwn(tools, id)).map(([id, definition]) => ({ id, ...definition }))]);
  }),
  route(companyPath + '/knowledge', 'GET', async c => c.json(await listKnowledge(await ownedCompany(c)))),
  route(companyPath + '/knowledge', 'POST', async c => {
    const companyId = await ownedCompany(c);
    const result = await uploadKnowledge(companyId, await readKnowledgeFile(c.req.raw));
    return c.json(result, result.duplicate ? 200 : 201);
  }),
  route(companyPath + '/knowledge/search', 'POST', async c => {
    const companyId = await ownedCompany(c);
    const { query } = await readBody(c, z.object({ query: z.string().trim().min(2).max(300) }));
    return c.json(await retrieveKnowledge(companyId, query));
  }),
  route(companyPath + '/knowledge/:sourceId', 'DELETE', async c => {
    const companyId = await ownedCompany(c);
    if (!await deleteKnowledge(companyId, uuid.parse(c.req.param('sourceId')))) {
      throw new RequestError('Knowledge document not found.', 404);
    }
    return c.json({ deleted: true });
  }),
  route(companyPath + '/settings/sandbox', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const input = await readBody(c, modalCredentialsSchema.nullable());
    await db.query(`insert into agentops.company_settings (company_id, sandbox_modal_token_id, sandbox_modal_token_secret)
      values ($1, $2, $3) on conflict (company_id) do update set
        sandbox_modal_token_id = excluded.sandbox_modal_token_id, sandbox_modal_token_secret = excluded.sandbox_modal_token_secret`,
      [companyId, input?.tokenId ?? null, input?.tokenSecret ?? null]);
    return c.json({ saved: true });
  }),
  route(companyPath + '/settings/search', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const input = await readBody(c, z.object({ provider: z.enum(searchProviders), apiKey: z.string().trim().min(1).max(500) }).nullable());
    await db.query(`insert into agentops.company_settings (company_id, search_provider, search_api_key) values ($1, $2, $3)
      on conflict (company_id) do update set search_provider = excluded.search_provider, search_api_key = excluded.search_api_key`,
      [companyId, input?.provider ?? null, input?.apiKey ?? null]);
    return c.json({ saved: true });
  }),
  route(companyPath + '/settings', 'GET', async c => {
    const companyId = await ownedCompany(c);
    const [config, bindings] = await Promise.all([
      credentials(companyId), Promise.all(platformSchema.options.map(platform => loadChannel(companyId, platform))),
    ]);
    const channels = bindings.flatMap(row => row ? [publicChannel(row)] : []);
    if (!channels.some(channel => channel.platform === 'telegram') && telegram?.companyId === companyId) channels.push({ platform: 'telegram', employeeId: telegram.employeeId,
      senderId: process.env.AGENTOPS_TELEGRAM_SENDER_ID ?? '', botName: process.env.TELEGRAM_BOT_USERNAME ?? '',
      webhookPath: telegram.webhookPath, webhookUrl: null, source: 'environment' });
    return c.json({
      model: {
        id: configuredModel(config).id, custom: Boolean(config.model_id),
        source: configuredModel(config).apiKey ? 'workspace' :
          config.model_id || process.env.MISTRAL_API_KEY ? 'environment' : 'missing',
      },
      connect: { projectId: config.connect_project_id, configured: Boolean(config.connect_access_token) },
      search: config.search_provider,
      sandbox: Boolean(modalSandboxCredentials(config)),
      channelCatalog: channelCatalog(),
      channels,
    });
  }),
  route(companyPath + '/settings/models', 'GET', async c => {
    await ownedCompany(c);
    const provider = c.req.query('provider');
    return provider ? c.json(providerModelIds(provider)) : c.json(modelProviders);
  }),
  route(companyPath + '/settings/models/default', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const input = await readBody(c, z.object({
      modelId: z.string().trim().min(3).max(300),
      apiKey: z.string().trim().min(1).max(1000).nullable(),
    }).nullable());
    if (input && !await verifyModel(input.modelId, input.apiKey)) {
      throw new RequestError('The runtime could not generate a reply with this model and credential.', 400);
    }
    await db.query(`insert into agentops.company_settings (company_id, model_id, model_api_key) values ($1, $2, $3)
      on conflict (company_id) do update set model_id = excluded.model_id, model_api_key = excluded.model_api_key`,
    [companyId, input?.modelId ?? null, input?.apiKey ?? null]);
    return c.json({ saved: true });
  }),
  route(companyPath + '/settings/model', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const { apiKey } = await readBody(c, z.object({ apiKey: z.string().trim().min(1).max(500).nullable() }));
    if (apiKey) {
      const account = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(8000),
      }).then(async response => response.ok ? response.json() : null).catch(() => null);
      if (!Array.isArray(account?.data) || !account.data.some((model: { id: string }) => model.id === employeeModel.split('/')[1])) {
        throw new RequestError('Mistral could not verify access to the configured model.', 400);
      }
    }
    await db.query(`insert into agentops.company_settings (company_id, mistral_api_key) values ($1, $2)
      on conflict (company_id) do update set mistral_api_key = excluded.mistral_api_key`, [companyId, apiKey]);
    return c.json({ saved: true });
  }),
  route(companyPath + '/settings/connect', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const input = await readBody(c, z.object({ projectId: z.string().trim().min(1).max(150), accessToken: z.string().trim().min(1).max(1000) }).nullable());
    if (input) {
      try {
        await discoverTools(companyId, { connect_project_id: input.projectId,
          connect_access_token: input.accessToken }, true);
      } catch {
        throw new RequestError('The integration hub could not verify this project and access token.', 400);
      }
    }
    await db.query(`insert into agentops.company_settings (company_id, connect_project_id, connect_access_token)
      values ($1, $2, $3) on conflict (company_id) do update set
      connect_project_id = excluded.connect_project_id, connect_access_token = excluded.connect_access_token`,
    [companyId, input?.projectId, input?.accessToken]);
    return c.json({ saved: true });
  }),
  route(companyPath + '/settings/connect/tools', 'GET', async c => {
    const companyId = await ownedCompany(c);
    const config = await credentials(companyId);
    const connected = await discoverTools(companyId, config, true).catch(() => {
      throw new RequestError('The integration hub is unavailable for this project.', 409);
    });
    return c.json(Object.entries(connectCatalog).map(([id, tool]) => ({ id, ...tool, available: Object.hasOwn(connected, id) })));
  }),
  route(companyPath + '/settings/integrations', 'GET', async c => {
    const companyId = await ownedCompany(c);
    return c.json(await integrationInventory(companyId, await credentials(companyId), c.req.query('refresh') === 'true'));
  }),
  route(companyPath + '/settings/channels/:platform', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const platform = platformSchema.parse(c.req.param('platform'));
    const input = await readBody(c, channelInput);
    if (platform !== input.platform) throw new RequestError('Channel type does not match the request.', 400);
    await loadRoster(companyId, [input.employeeId]);
    const verified = await verifyChannel(input);
    if (!verified) throw new RequestError('The provider could not verify this bot token.', 400);
    const existing = await loadChannel(companyId, platform);
    const reuseWebhook = platform === 'telegram' && existing?.installation_id === verified.installationId;
    try {
      await db.query(`insert into agentops.company_channels
        (company_id, platform, employee_id, sender_id, installation_id, bot_name, bot_token, webhook_secret, webhook_url, verify_token)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (company_id, platform) do update set employee_id = excluded.employee_id, sender_id = excluded.sender_id,
        installation_id = excluded.installation_id, bot_name = excluded.bot_name, bot_token = excluded.bot_token,
        webhook_secret = excluded.webhook_secret, webhook_url = excluded.webhook_url,
        verify_token = excluded.verify_token, updated_at = clock_timestamp()`,
      [companyId, platform, input.employeeId, input.senderId, verified.installationId, verified.botName, input.botToken,
        reuseWebhook ? existing.webhook_secret : verified.secret, reuseWebhook ? existing.webhook_url : null,
        input.platform === 'whatsapp' ? input.verifyToken : null]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new RequestError('This bot is already linked to another workspace.', 409);
      throw error;
    }
    return c.json({ webhookPath: webhookPath(companyId, platform) });
  }),
  route(companyPath + '/settings/channels/:platform', 'DELETE', async c => {
    const companyId = await ownedCompany(c);
    const platform = platformSchema.parse(c.req.param('platform'));
    await db.query('delete from agentops.company_channels where company_id = $1 and platform = $2', [companyId, platform]);
    return c.json({ removed: true });
  }),
  route(companyPath + '/settings/channels/discord/register', 'POST', async c => {
    const registered = await registerDiscordCommand(await ownedCompany(c));
    if (registered === null) throw new RequestError('Connect a Discord bot first.', 404);
    if (!registered) throw new RequestError('Discord could not register the slash command.', 409);
    return c.json({ registered: true });
  }),
  route(companyPath + '/settings/channels/telegram/register', 'POST', async c => {
    const companyId = await ownedCompany(c);
    const { origin } = await readBody(c, z.object({ origin: z.url({ protocol: /^https$/ }) }));
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new RequestError('Enter the public HTTPS origin of the AgentOps service.', 400);
    }
    const webhookUrl = await registerTelegramWebhook(companyId, url.origin);
    if (webhookUrl === null) throw new RequestError('Connect a Telegram bot first.', 404);
    if (!webhookUrl) throw new RequestError('Telegram could not register the webhook. Check the public service URL.', 400);
    return c.json({ webhookUrl });
  }),
  route(companyPath + '/employees/:employeeId', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const employeeId = uuid.parse(c.req.param('employeeId'));
    const input = await readBody(c, employeeInput);
    const { rows: [employee] } = await db.query(
      `update agentops.employees set name = $3, role = $4, instructions = $5, tool_ids = coalesce($6, tool_ids)
       where company_id = $1 and id = $2 returning *`,
      [companyId, employeeId, input.name, input.role, input.instructions, input.toolIds],
    );
    if (!employee) throw new RequestError('Employee not found.', 404);
    return c.json(employee);
  }),
  route(companyPath + '/teams', 'GET', async c => {
    const companyId = await accessCompany(c);
    const { rows } = await db.query(
      'select * from agentops.teams where company_id = $1 order by name, id',
      [companyId],
    );
    return c.json(rows);
  }),
  route(companyPath + '/teams', 'POST', async c => {
    const companyId = await ownedCompany(c);
    const input = await readBody(c, teamInput);
    await loadRoster(companyId, input.employeeIds);
    const { rows: [team] } = await db.query(
      `insert into agentops.teams (company_id, name, lead_employee_id, employee_ids)
       values ($1, $2, $3, $4) returning *`,
      [companyId, input.name, input.leadEmployeeId, input.employeeIds],
    );
    return c.json(team, 201);
  }),
  route(companyPath + '/teams/:teamId', 'PUT', async c => {
    const companyId = await ownedCompany(c);
    const teamId = uuid.parse(c.req.param('teamId'));
    const input = await readBody(c, teamInput);
    await loadRoster(companyId, input.employeeIds);
    const { rows: [team] } = await db.query(
      `update agentops.teams set name = $3, lead_employee_id = $4, employee_ids = $5
       where company_id = $1 and id = $2 returning *`,
      [companyId, teamId, input.name, input.leadEmployeeId, input.employeeIds],
    );
    if (!team) throw new RequestError('Team not found.', 404);
    return c.json(team);
  }),
  route(companyPath + '/tasks', 'GET', async c => {
    const companyId = await accessCompany(c);
    const { rows } = await db.query(
      'select * from agentops.tasks where company_id = $1 order by created_at desc, id limit 100',
      [companyId],
    );
    return c.json(rows);
  }),
  route(companyPath + '/tasks', 'POST', async c => {
    const result = await submitTask(await accessCompany(c), await readBody(c, taskInput), c.get('mastra'));
    return c.json(result.task, result.created ? 201 : 200);
  }),
  route(companyPath + '/tasks/background', 'POST', async c => {
    const companyId = await accessCompany(c);
    const input = await readBody(c, taskInput);
    const { task, created } = await submitTask(companyId, input, c.get('mastra'), 'queue');
    if (!created) return c.json(task);
    try {
      const run = await backgroundTask.createRun({ runId: task.id, resourceId: companyId });
      await run.startAsync({ inputData: { companyId, task: input } });
      return c.json(task, 202);
    } catch (error) {
      console.error('Background task dispatch failed:', task.id, error instanceof Error ? error.name : 'Unknown error');
      await failQueuedTask(companyId, task.id, 'The worker could not accept this task. Submit a new task to retry.');
      throw new RequestError('Could not start the background task.', 409);
    }
  }),
  route(companyPath + '/schedules', 'GET', async c => {
    const resourceId = await ownedCompany(c);
    return c.json(await c.get('mastra').schedules.list({ workflowId: scheduledTask.id, resourceId }));
  }),
  route(companyPath + '/schedules', 'POST', async c => {
    const companyId = await ownedCompany(c);
    const input = await readBody(c, z.object({
      task: taskInput, name, runAt: z.iso.datetime({ offset: true }).optional(),
      cron: z.string().trim().min(1).max(100).optional(), timezone: z.string().max(80).default('UTC'),
    }).refine(value => Boolean(value.runAt) !== Boolean(value.cron), 'Choose either a date or a recurring schedule.'));
    if (input.runAt && Date.parse(input.runAt) <= Date.now()) throw new RequestError('Choose a future date.', 400);
    try {
      return c.json(await c.get('mastra').schedules.create({
        workflowId: scheduledTask.id, resourceId: companyId, metadata: { name: input.name },
        inputData: { companyId, task: input.task }, runAt: input.runAt ? Date.parse(input.runAt) : undefined,
        cron: input.cron, timezone: input.timezone,
      }), 201);
    } catch {
      throw new RequestError('Could not create this schedule. Check the date, cron expression, and time zone.', 400);
    }
  }),
  route(companyPath + '/schedules/:scheduleId/action', 'POST', async c => {
    const { schedules, schedule } = await scheduleForCompany(c);
    const { action } = await readBody(c, z.object({ action: z.enum(['pause', 'resume', 'run']) }));
    try {
      if (action === 'pause' && schedule.status === 'active') return c.json(await schedules.pause(schedule.id));
      if (action === 'resume' && schedule.status === 'paused') return c.json(await schedules.resume(schedule.id));
      if (action === 'run' && schedule.cron && schedule.status === 'active') return c.json(await schedules.run(schedule.id), 202);
    } catch {
      throw new RequestError('The schedule could not perform this action. Refresh and try again.', 409);
    }
    throw new RequestError('This action is unavailable for the current schedule.', 409);
  }),
  route(companyPath + '/schedules/:scheduleId/history', 'GET', async c => {
    const { schedule, companyId } = await scheduleForCompany(c);
    const store = await c.get('mastra').getStorage()?.getStore('schedules');
    if (!store) throw new RequestError('Schedule history is unavailable.', 409);
    const triggers = await store.listTriggers(schedule.id, { limit: 15 });
    const taskIds = triggers.flatMap(trigger => trigger.runId ? [scheduledTaskId(companyId, trigger.runId)] : []);
    const { rows } = await db.query<{ id: string; status: string }>(
      'select id, status from agentops.tasks where company_id = $1 and id = any($2::uuid[])',
      [companyId, taskIds],
    );
    const tasks = new Map(rows.map(task => [task.id, task]));
    return c.json(triggers.map(({ id, actualFireAt, outcome, triggerKind, runId }) => ({
      id, actualFireAt, outcome, triggerKind,
      task: runId ? tasks.get(scheduledTaskId(companyId, runId)) ?? null : null,
    })));
  }),
  route(companyPath + '/schedules/:scheduleId', 'DELETE', async c => {
    const { schedules, schedule } = await scheduleForCompany(c);
    await schedules.delete(schedule.id);
    return c.json({ removed: true });
  }),
  route(companyPath + '/tasks/:taskId/delegations', 'GET', async c => {
    const companyId = await accessCompany(c);
    const taskId = uuid.parse(c.req.param('taskId'));
    const { rows: [task] } = await db.query(
      'select id from agentops.tasks where company_id = $1 and id = $2',
      [companyId, taskId],
    );
    if (!task) throw new RequestError('Task not found.', 404);
    const { rows } = await db.query(
      'select * from agentops.task_delegations where task_id = $1 order by started_at, tool_call_id',
      [taskId],
    );
    return c.json(rows);
  }),
  route(companyPath + '/tasks/:taskId', 'GET', async c => {
    return c.json(await taskForCompany(await accessCompany(c), uuid.parse(c.req.param('taskId'))));
  }),
  route(companyPath + '/members', 'GET', async c => {
    const companyId = await ownedCompany(c);
    const { rows } = await db.query(
      `select u.id, u.email, 'owner' as role from agentops.companies c join agentops.users u on u.id = c.owner_id where c.id = $1
       union all
       select u.id, u.email, 'member' from agentops.company_members m join agentops.users u on u.id = m.user_id
       where m.company_id = $1 order by role desc, email`, [companyId],
    );
    return c.json(rows);
  }),
  route(companyPath + '/members', 'POST', async c => {
    const companyId = await ownedCompany(c);
    const { email } = await readBody(c, z.object({ email: z.email() }));
    const { rows: [member] } = await db.query<{ id: string; email: string }>(
      'select id, email from agentops.users where lower(email) = lower($1) and email_confirmed_at is not null', [email],
    );
    if (!member) throw new RequestError('Ask the confirmed user to sign in to AgentOps first.', 404);
    if (member.id === userId(c)) throw new RequestError('This user already owns the company.', 409);
    await db.query('insert into agentops.company_members values ($1, $2) on conflict do nothing', [companyId, member.id]);
    return c.json({ ...member, role: 'member' });
  }),
  route(companyPath + '/members/:memberId', 'DELETE', async c => {
    const companyId = await ownedCompany(c);
    await db.query('delete from agentops.company_members where company_id = $1 and user_id = $2',
      [companyId, uuid.parse(c.req.param('memberId'))]);
    return c.json({ removed: true });
  }),
  route(companyPath + '/employees/:employeeId/chat', 'GET', async c => {
    const companyId = await accessCompany(c);
    const employeeId = uuid.parse(c.req.param('employeeId'));
    await loadRoster(companyId, [employeeId]);
    return c.json(await history(apiConversation(companyId, userId(c), employeeId)));
  }),
  route(companyPath + '/employees/:employeeId/chat', 'POST', async c => {
    const companyId = await accessCompany(c);
    const employeeId = uuid.parse(c.req.param('employeeId'));
    const [employee] = await loadRoster(companyId, [employeeId]);
    const { message } = await readBody(c, z.object({ message: content }));
    return c.json({ text: await converse(employee, message, apiConversation(companyId, userId(c), employeeId),
      { companyId, userId: userId(c), channel: 'web' }, c.get('mastra')) });
  }),
  route(companyPath + '/employees/:employeeId/chat/stream', 'POST', async c => {
    const companyId = await accessCompany(c);
    const employeeId = uuid.parse(c.req.param('employeeId'));
    const [employee] = await loadRoster(companyId, [employeeId]);
    const { message } = await readBody(c, z.object({ message: content }));
    return streamConversation(employee, message, apiConversation(companyId, userId(c), employeeId),
      { companyId, userId: userId(c), channel: 'web' }, c.get('mastra'));
  }),
  route(companyPath + '/channel-threads', 'GET', async c => {
    const companyId = await accessCompany(c);
    const callerId = userId(c);
    const { rows } = await db.query<{ platform: Platform | null }>(
      `select h.platform from agentops.companies c left join agentops.company_channels h on h.company_id = c.id
       where c.id = $1 and c.owner_id = $2`,
      [companyId, callerId],
    );
    const platforms = new Set(rows.flatMap(row => row.platform ? [row.platform] : []));
    if (rows.length && telegram?.companyId === companyId && telegram.userId === callerId) platforms.add('telegram');
    return c.json([...platforms].sort());
  }),
  ...platformSchema.options.map(platform => route(companyPath + '/' + platform, 'GET', async c => {
    const companyId = await accessCompany(c);
    const callerId = userId(c);
    const managed = await loadChannel(companyId, platform);
    if (managed) return c.json(managed.owner_id === callerId
      ? { employeeId: managed.employee_id, messages: await history(channelConversation(managed)) } : null);
    if (platform === 'telegram' && telegram?.companyId === companyId && telegram.userId === callerId &&
      (await db.query('select id from agentops.companies where id = $1 and owner_id = $2', [companyId, callerId])).rowCount) {
      return c.json({ employeeId: telegram.employeeId, messages: await history(telegram.conversation) });
    }
    return c.json(null);
  })),
  route(companyPath + '/activity', 'GET', async c => {
    const companyId = await accessCompany(c);
    const { runs } = await releaseReview.listWorkflowRuns({ resourceId: companyId, status: 'suspended', summary: true });
    const { rows } = await db.query(
      `with events as (
         select id::text, employee_id, id as task_id, 'task' as kind, status, created_at as started_at, false as can_open_chat
           from agentops.tasks where company_id = $1
         union all
         select d.task_id || ':' || d.tool_call_id, d.employee_id, d.task_id, 'delegation',
                case when t.status = 'failed' and d.status = 'running' then 'failed' else d.status end, d.started_at, false
           from agentops.task_delegations d join agentops.tasks t on t.id = d.task_id where t.company_id = $1
         union all
         select id::text, employee_id, null, channel, status, started_at, user_id = $3 from agentops.conversation_activity
           where company_id = $1 and (channel = 'web' or user_id = $3)
         union all
         select id || ':review', employee_id, id, 'review', 'awaiting approval', finished_at, false
           from agentops.tasks where company_id = $1 and id = any($2::uuid[])
       )
       select * from events order by (status in ('running', 'awaiting approval')) desc, started_at desc, id limit 100`,
      [companyId, runs.map((run: { runId: string }) => run.runId), userId(c)],
    );
    return c.json(rows);
  }),
  route(companyPath + '/tasks/:taskId/review', 'GET', async c => {
    const task = await taskForCompany(await accessCompany(c), uuid.parse(c.req.param('taskId')));
    return c.json(await reviewState(task.id));
  }),
  route(companyPath + '/workflows/release-brief-review/runs', 'GET', async c => {
    const companyId = await accessCompany(c);
    const { runs, total } = await releaseReview.listWorkflowRuns({ resourceId: companyId, page: 0, perPage: 100, summary: true });
    return c.json({ total, runs: runs.map((run: import('@mastra/core/storage').WorkflowRun) => ({
      taskId: run.runId, status: typeof run.snapshot === 'string' ? JSON.parse(run.snapshot).status : run.snapshot.status,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
    })) });
  }),
  route(companyPath + '/tasks/:taskId/review', 'POST', async c => {
    const task = await taskForCompany(await accessCompany(c), uuid.parse(c.req.param('taskId')));
    const brief = releaseBrief.safeParse(task.result_data);
    if (task.status !== 'succeeded' || task.output_format !== 'release_brief' || !brief.success) {
      throw new RequestError('A completed release brief is required.', 409);
    }
    return c.json(await withReviewLock(task.id, async () => {
      const existing = await reviewState(task.id);
      if (existing && existing.status !== 'pending') return existing;
      const run = await releaseReview.createRun({ runId: task.id, resourceId: task.company_id });
      await run.start({ inputData: brief.data });
      return reviewState(task.id);
    }));
  }),
  route(companyPath + '/tasks/:taskId/review/decision', 'POST', async c => {
    const task = await taskForCompany(await ownedCompany(c), uuid.parse(c.req.param('taskId')));
    const { approved, note } = await readBody(c, z.object({ approved: z.boolean(), note: z.string().trim().max(1000).optional() }));
    return c.json(await withReviewLock(task.id, async () => {
      const existing = await reviewState(task.id);
      if (existing?.decision?.approved === approved) return existing;
      if (existing?.status !== 'suspended') throw new RequestError('This brief is not awaiting a decision.', 409);
      const run = await releaseReview.createRun({ runId: task.id, resourceId: task.company_id });
      await run.resume({ step: 'review', resumeData: { approved, note, reviewerId: userId(c) } });
      return reviewState(task.id);
    }));
  }),
];
