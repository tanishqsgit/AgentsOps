import { createHash } from 'node:crypto';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { Agent } from '@mastra/core/agent';
import type { ChannelHandler } from '@mastra/core/channels';
import { z } from 'zod';
import { db } from '../db.ts';
import { employeeModel, type EmployeeProfile } from './employee.ts';
import { converse } from './conversation.ts';

const settings = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]+$/),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  AGENTOPS_TELEGRAM_SENDER_ID: z.string().regex(/^[1-9]\d*$/),
  AGENTOPS_TELEGRAM_OWNER_ID: z.uuid(),
  AGENTOPS_TELEGRAM_COMPANY_ID: z.uuid(),
  AGENTOPS_TELEGRAM_EMPLOYEE_ID: z.uuid(),
});

function configureTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return undefined;
  const env = settings.parse(process.env);
  const botId = env.TELEGRAM_BOT_TOKEN.split(':')[0];
  // A different binding gets a fresh Mastra agent identity and conversation.
  const binding = [
    botId, env.AGENTOPS_TELEGRAM_SENDER_ID, env.AGENTOPS_TELEGRAM_OWNER_ID,
    env.AGENTOPS_TELEGRAM_COMPANY_ID, env.AGENTOPS_TELEGRAM_EMPLOYEE_ID,
  ].join(':');
  const agentId = 'telegram-' + createHash('sha256').update(binding).digest('hex').slice(0, 24);
  const resourceId = 'agentops:' + binding;
  const webhookPath = `/api/agents/${agentId}/channels/telegram/webhook`;
  const conversation = { resource: resourceId, thread: agentId };

  const authorizedDm: ChannelHandler = async (thread, message) => {
    const prompt = message.text?.trim();
    if (!thread.isDM || message.author.userId !== env.AGENTOPS_TELEGRAM_SENDER_ID || !prompt) return;
    try {
      const { rows: [employee] } = await db.query<EmployeeProfile>(
        `select e.*
         from agentops.employees e
         join agentops.companies c on c.id = e.company_id
         where c.id = $1 and c.owner_id = $2 and e.id = $3`,
        [env.AGENTOPS_TELEGRAM_COMPANY_ID, env.AGENTOPS_TELEGRAM_OWNER_ID, env.AGENTOPS_TELEGRAM_EMPLOYEE_ID],
      );
      if (!employee) return;
      await converse(employee, prompt, conversation, {
        companyId: env.AGENTOPS_TELEGRAM_COMPANY_ID,
        userId: env.AGENTOPS_TELEGRAM_OWNER_ID,
        channel: 'telegram',
      }, agent.getMastraInstance(), text => thread.post(text));
    } catch (error) {
      console.error('AgentOps could not process a Telegram DM:', error instanceof Error ? error.name : 'Unknown error');
      await thread.post('AgentOps could not answer right now. Please try again.').catch(() => {});
    }
  };

  const agent = new Agent({
    id: agentId,
    name: 'AgentOps Telegram',
    model: employeeModel,
    instructions: 'AgentOps routes authorized direct messages to a configured employee.',
    channels: {
      adapters: {
        telegram: createTelegramAdapter({
          mode: 'webhook',
          botToken: env.TELEGRAM_BOT_TOKEN,
          userName: env.TELEGRAM_BOT_USERNAME,
          secretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
          allowedUserIds: [env.AGENTOPS_TELEGRAM_SENDER_ID],
        }),
      },
      handlers: {
        onDirectMessage: authorizedDm,
        onSubscribedMessage: authorizedDm,
        onMention: false,
        onSlashCommand: false,
        onAction: false,
      },
    },
  });
  console.info(`AgentOps Telegram webhook path: ${webhookPath}`);
  return { agent, webhookPath, conversation, companyId: env.AGENTOPS_TELEGRAM_COMPANY_ID,
    userId: env.AGENTOPS_TELEGRAM_OWNER_ID, employeeId: env.AGENTOPS_TELEGRAM_EMPLOYEE_ID };
}

export const telegram = configureTelegram();
