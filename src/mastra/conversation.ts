import { createHash } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { toAISdkStream } from '@mastra/ai-sdk';
import { toAISdkMessages } from '@mastra/ai-sdk/ui';
import { consumeStream, createUIMessageStreamResponse } from 'ai';
import { db } from '../db.ts';
import type { EmployeeProfile } from './employee.ts';
import { modelWithKey, providerOptionsFor, contextProcessors, reserveFinalStep } from './models.ts';
import { memory } from './storage.ts';
import { employeeRuntime, employeeTools } from './tools.ts';

export function apiConversation(companyId: string, userId: string, employeeId: string) {
  const resource = `agentops:api:${companyId}:${userId}:${employeeId}`;
  return { resource, thread: 'api-' + createHash('sha256').update(resource).digest('hex') };
}

export async function history({ thread, resource }: ReturnType<typeof apiConversation>) {
  const record = await memory.getThreadById({ threadId: thread });
  if (record?.resourceId !== resource) return [];
  const { messages } = await memory.recall({ threadId: thread, resourceId: resource, perPage: 50, orderBy: { field: 'createdAt', direction: 'DESC' } });
  const sorted = messages.filter(message => message.role === 'user' || message.role === 'assistant')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() ||
      Number(a.role === 'assistant') - Number(b.role === 'assistant'));
  const dates = new Map(sorted.map(message => [message.id, message.createdAt]));
  return toAISdkMessages(sorted, { version: 'v7' }).flatMap(message => {
    const parts = message.parts.filter(part => part.type !== 'reasoning');
    if (!parts.some(part => part.type !== 'step-start')) return [];
    const text = parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
    return [{ id: message.id, role: message.role, text, parts, createdAt: dates.get(message.id) }];
  });
}

type ConversationScope = ReturnType<typeof apiConversation>;
type ConversationActivity = { companyId: string; userId: string; channel: 'web' | 'telegram' | 'slack' | 'discord' | 'whatsapp' };

export class ConversationBusyError extends Error {
  constructor() { super('This conversation is already waiting for a reply. Try again when it finishes.'); }
}

async function startConversation(employeeId: string, activity: ConversationActivity) {
  const client = await db.connect();
  const identity = [activity.companyId, employeeId, activity.userId, activity.channel];
  let runId: string;
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['conversation:' + identity.join(':')]);
    const scope = 'company_id = $1 and employee_id = $2 and user_id = $3 and channel = $4';
    await client.query(`update agentops.conversation_activity set status = 'failed'
      where ${scope} and status = 'running' and started_at < now() - interval '3 minutes'`, identity);
    const { rows: [run] } = await client.query<{ id: string }>(
      `insert into agentops.conversation_activity (company_id, employee_id, user_id, channel, status)
       select $1, $2, $3, $4, 'running' where not exists (
         select 1 from agentops.conversation_activity where ${scope} and status = 'running'
       ) returning id`, identity);
    if (!run) throw new ConversationBusyError();
    runId = run.id;
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return (status: 'succeeded' | 'failed') =>
    db.query("update agentops.conversation_activity set status = $2 where id = $1 and status = 'running'", [runId, status]);
}

async function conversationAgent(employee: EmployeeProfile, scope: ConversationScope, mastra: import('@mastra/core/mastra').Mastra | undefined) {
  const runtime = await employeeRuntime(employee.company_id, [employee]);
  const tools = employeeTools(employee.tool_ids, runtime.connected);
  const maxSteps = Object.keys(tools).length ? 3 : 1;
  return new Agent({
    id: scope.thread, name: employee.name, instructions: employee.instructions,
    model: modelWithKey(runtime.model.id, runtime.model.apiKey), memory, tools, mastra,
    inputProcessors: [...contextProcessors(runtime.model.id), ...(maxSteps > 1 ? [reserveFinalStep(maxSteps)] : [])],
    defaultOptions: { providerOptions: providerOptionsFor(runtime.model.id), maxSteps,
      tracingOptions: { hideInput: true, hideOutput: true },
      modelSettings: { maxOutputTokens: 4096 } },
  });
}

export async function converse(
  employee: EmployeeProfile, prompt: string, scope: ConversationScope, activity: ConversationActivity,
  mastra: import('@mastra/core/mastra').Mastra | undefined,
  deliver?: (text: string) => Promise<unknown>,
) {
  const finish = await startConversation(employee.id, activity);
  let status: 'succeeded' | 'failed' = 'failed';
  try {
    const abortSignal = AbortSignal.timeout(90_000);
    const agent = await conversationAgent(employee, scope, mastra);
    abortSignal.throwIfAborted();
    const result = await agent.generate(prompt, { memory: scope, abortSignal });
    abortSignal.throwIfAborted();
    if (result.finishReason === 'error' || !result.text?.trim()) throw new Error('Empty employee reply.');
    await deliver?.(result.text);
    status = 'succeeded';
    return result.text;
  } finally {
    await finish(status);
  }
}

export async function streamConversation(
  employee: EmployeeProfile, prompt: string, scope: ConversationScope, activity: ConversationActivity,
  mastra: import('@mastra/core/mastra').Mastra,
) {
  const finish = await startConversation(employee.id, activity);
  try {
    const abortSignal = AbortSignal.timeout(90_000);
    const agent = await conversationAgent(employee, scope, mastra);
    abortSignal.throwIfAborted();
    const output = await agent.stream(prompt, { memory: scope, abortSignal });
    return createUIMessageStreamResponse({
      stream: toAISdkStream(output, {
        from: 'agent', version: 'v7', sendReasoning: false, sendSources: true,
        onError: () => 'The employee could not complete this reply.',
      }),
      async consumeSseStream({ stream }) {
        let status: 'succeeded' | 'failed' = 'failed';
        try {
          await consumeStream({ stream });
          const reason = await output.finishReason;
          if (reason && reason !== 'error' && !abortSignal.aborted) status = 'succeeded';
        } catch (error) {
          console.error('AgentOps chat stream failed:', error instanceof Error ? error.name : 'Unknown error');
        } finally {
          await finish(status).catch(error => console.error('AgentOps chat status update failed:', error instanceof Error ? error.name : 'Unknown error'));
        }
      },
    });
  } catch (error) {
    await finish('failed');
    throw error;
  }
}
