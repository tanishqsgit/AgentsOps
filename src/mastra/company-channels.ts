import { createDiscordAdapter } from '@chat-adapter/discord';
import { CHANNELS } from '@mastra/connect';
import { createHash, randomBytes } from 'node:crypto';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createWhatsAppAdapter } from '@chat-adapter/whatsapp';
import { Agent } from '@mastra/core/agent';
import type { ChannelHandler } from '@mastra/core/channels';
import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { db } from '../db.ts';
import { employeeModel, type EmployeeProfile } from './employee.ts';
import { converse } from './conversation.ts';

export const platformSchema = z.enum(['telegram', 'slack', 'discord', 'whatsapp']);
export type Platform = z.infer<typeof platformSchema>;
const documentedAdapters = {
  agentphone: 'AgentPhone', baileys: 'Baileys WhatsApp', discord: 'Discord', github: 'GitHub',
  'google-chat': 'Google Chat', imessage: 'iMessage', kapso: 'Kapso', lark: 'Lark / Feishu',
  linear: 'Linear', linq: 'Linq', liveblocks: 'Liveblocks', matrix: 'Matrix', mattermost: 'Mattermost',
  messenger: 'Messenger', 'microsoft-teams': 'Microsoft Teams', novu: 'Novu', resend: 'Resend',
  ring: 'Ring', sendblue: 'Sendblue', slack: 'Slack', telegram: 'Telegram', twilio: 'Twilio',
  velt: 'Velt', web: 'Web', webex: 'Webex', wechat: 'WeChat', whatsapp: 'WhatsApp Business Cloud',
  x: 'X', zalo: 'Zalo', zernio: 'Zernio',
};
export function channelCatalog() {
  const managed = new Set(CHANNELS.map(entry => entry.integrationId === 'slack-channels' ? 'slack' : entry.integrationId));
  const names: Record<string, string> = documentedAdapters;
  return [...new Set([...Object.keys(names), ...managed])].map(id => ({
    id, name: names[id] ?? id, setup: platformSchema.safeParse(id).success, managedAdapter: managed.has(id),
  })).sort((a, b) => Number(b.setup) - Number(a.setup) || a.name.localeCompare(b.name));
}
type Channel = {
  company_id: string; platform: Platform; sender_id: string; employee_id: string; owner_id: string;
  installation_id: string; bot_name: string; bot_token: string; webhook_secret: string; webhook_url: string | null;
  verify_token: string | null;
  updated_at: Date;
};

export const webhookPath = (companyId: string, platform: Platform) => `/agentops/v1/channel-webhooks/${companyId}/${platform}`;
export const channelInput = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('telegram'), botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/),
    senderId: z.string().regex(/^[1-9]\d*$/), employeeId: z.uuid() }),
  z.object({ platform: z.literal('discord'), botToken: z.string().trim().min(20).max(256),
    senderId: z.string().regex(/^\d{17,22}$/), employeeId: z.uuid(), signingSecret: z.string().regex(/^[A-Fa-f0-9]{64}$/) }),
  z.object({ platform: z.literal('whatsapp'), botToken: z.string().trim().min(20).max(4096),
    senderId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{5,128}$/), employeeId: z.uuid(),
    phoneNumberId: z.string().regex(/^\d+$/), signingSecret: z.string().trim().min(16).max(256),
    verifyToken: z.string().trim().min(12).max(256) }),
  z.object({ platform: z.literal('slack'), botToken: z.string().regex(/^xoxb-[A-Za-z0-9-]+$/),
    senderId: z.string().regex(/^[UW][A-Z0-9]+$/), employeeId: z.uuid(), signingSecret: z.string().min(16).max(256) }),
]);

export async function loadChannel(companyId: string, platform: Platform) {
  const { rows: [row] } = await db.query<Channel>(
    `select h.*, c.owner_id from agentops.company_channels h
     join agentops.companies c on c.id = h.company_id where h.company_id = $1 and h.platform = $2`,
    [companyId, platform],
  );
  return row;
}

export function publicChannel(row: Channel) {
  return { platform: row.platform, senderId: row.sender_id, employeeId: row.employee_id, botName: row.bot_name,
    webhookPath: webhookPath(row.company_id, row.platform), webhookUrl: row.webhook_url, source: 'workspace' };
}

export async function verifyChannel(input: z.infer<typeof channelInput>) {
  try {
    if (input.platform === 'telegram') {
      const response = await fetch(`https://api.telegram.org/bot${input.botToken}/getMe`, { signal: AbortSignal.timeout(7000) });
      const data = await response.json();
      if (response.ok && data.ok && data.result?.is_bot && typeof data.result.username === 'string') {
        return { installationId: String(data.result.id), botName: data.result.username, secret: randomBytes(24).toString('hex') };
      }
    } else if (input.platform === 'discord') {
      const response = await fetch('https://discord.com/api/v10/applications/@me', {
        headers: { Authorization: 'Bot ' + input.botToken }, signal: AbortSignal.timeout(7000),
      });
      const app = await response.json();
      if (response.ok && typeof app.id === 'string' && typeof app.name === 'string' &&
        typeof app.verify_key === 'string' && app.verify_key.toLowerCase() === input.signingSecret.toLowerCase()) {
        return { installationId: app.id, botName: app.name, secret: input.signingSecret };
      }
    } else if (input.platform === 'whatsapp') {
      const url = new URL('https://graph.facebook.com/v25.0/' + input.phoneNumberId);
      url.searchParams.set('fields', 'id,display_phone_number');
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + input.botToken }, signal: AbortSignal.timeout(7000),
      });
      const phone = await response.json();
      if (response.ok && phone.id === input.phoneNumberId && typeof phone.display_phone_number === 'string') {
        return { installationId: phone.id, botName: phone.display_phone_number, secret: input.signingSecret };
      }
    } else {
      const response = await fetch('https://slack.com/api/auth.test', { method: 'POST', signal: AbortSignal.timeout(7000),
        headers: { Authorization: 'Bearer ' + input.botToken } });
      const data = await response.json();
      if (response.ok && data.ok && data.team_id && data.user_id) {
        return { installationId: `${data.team_id}:${data.user_id}`, botName: data.user ?? data.user_id, secret: input.signingSecret };
      }
    }
  } catch { /* Provider errors are displayed without credentials. */ }
}

export async function registerTelegramWebhook(companyId: string, origin: string) {
  const channel = await loadChannel(companyId, 'telegram');
  if (!channel) return null;
  const url = new URL(webhookPath(companyId, 'telegram'), origin).href;
  try {
    const response = await fetch(`https://api.telegram.org/bot${channel.bot_token}/setWebhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(7000),
      body: JSON.stringify({ url, secret_token: channel.webhook_secret, allowed_updates: ['message'] }),
    });
    if (!response.ok || !(await response.json()).ok) return false;
    await db.query(
      "update agentops.company_channels set webhook_url = $2 where company_id = $1 and platform = 'telegram' and webhook_secret = $3",
      [companyId, url, channel.webhook_secret],
    );
    return url;
  } catch { return false; }
}

export async function registerDiscordCommand(companyId: string) {
  const channel = await loadChannel(companyId, 'discord');
  if (!channel) return null;
  const response = await fetch(`https://discord.com/api/v10/applications/${channel.installation_id}/commands`, {
    method: 'POST', signal: AbortSignal.timeout(7000),
    headers: { Authorization: 'Bot ' + channel.bot_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'agentops', description: 'Send a private message to your assigned employee',
      contexts: [1], options: [{ name: 'prompt', description: 'Message for your employee', type: 3, required: true }] }),
  }).catch(() => null);
  return response?.ok ?? false;
}

export function channelConversation(channel: Channel) {
  const resource = ['agentops', 'channel', channel.platform, channel.installation_id, channel.company_id,
    channel.owner_id, channel.sender_id, channel.employee_id].join(':');
  return { resource, thread: channel.platform + '-' + createHash('sha256').update(resource).digest('hex') };
}

const handlers = new Map<string, { version: number; channels: Promise<NonNullable<ReturnType<Agent['getChannels']>>> }>();

export async function dispatchChannel(channel: Channel, request: Request, mastra: Mastra) {
  const key = channel.company_id + ':' + channel.platform;
  const version = channel.updated_at.getTime();
  let entry = handlers.get(key);
  if (!entry || entry.version !== version) {
    const channels = initializeChannel(channel, mastra);
    entry = { version, channels };
    handlers.set(key, entry);
    void channels.catch(() => { if (handlers.get(key)?.channels === channels) handlers.delete(key); });
  }
  return (await entry.channels).handleWebhookEvent(channel.platform, request, {
    waitUntil: work => { void work.catch(() => console.error('Channel webhook processing failed:', channel.platform)); },
  });
}

async function initializeChannel(channel: Channel, mastra: Mastra) {
  const conversation = channelConversation(channel);
  async function replyToSender(senderId: string, text: string, deliver: (text: string) => Promise<unknown>) {
    if (senderId !== channel.sender_id || !text.trim()) return;
    const current = await loadChannel(channel.company_id, channel.platform);
    if (!current || current.updated_at.getTime() !== channel.updated_at.getTime() || current.owner_id !== channel.owner_id) return;
    const { rows: [employee] } = await db.query<EmployeeProfile>(
      'select * from agentops.employees where id = $1 and company_id = $2', [channel.employee_id, channel.company_id],
    );
    if (!employee) return;
    try {
      await converse(employee, text, conversation, { companyId: channel.company_id, userId: channel.owner_id,
        channel: channel.platform }, mastra, deliver);
    } catch {
      await deliver('AgentOps could not answer right now. Please try again.').catch(() => {});
    }
  }
  const authorizedDm: ChannelHandler = async (thread, message) => {
    if (channel.platform === 'whatsapp' && !thread.id.startsWith('whatsapp:' + channel.installation_id + ':')) return;
    if (thread.isDM) await replyToSender(message.author.userId, message.text, reply => thread.post(reply));
  };
  const adapter = createAdapter(channel);
  const agent = new Agent({ id: conversation.thread, name: 'AgentOps ' + channel.platform,
    model: employeeModel, instructions: 'Send authorized direct messages to the assigned employee.',
    channels: { adapters: { [channel.platform]: adapter }, handlers: { onDirectMessage: authorizedDm, onSubscribedMessage: authorizedDm,
      onMention: false, onSlashCommand: channel.platform === 'discord' ? async event => {
        const raw = event.raw as { guild_id?: string; application_id?: string } | undefined;
        if (event.command === '/agentops' && raw?.application_id === channel.installation_id && !raw.guild_id) {
          await replyToSender(event.user.userId, event.text, reply => event.channel.post(reply.slice(0, 1900)));
        }
      } : false, onAction: false } },
  });
  const channels = agent.getChannels();
  if (!channels) throw new Error('Channel initialization failed');
  await channels.initialize(mastra);
  return channels;
}

function createAdapter(channel: Channel) {
  const userName = channel.bot_name;
  switch (channel.platform) {
    case 'telegram':
      return createTelegramAdapter({ mode: 'webhook', botToken: channel.bot_token, userName,
        secretToken: channel.webhook_secret, allowedUserIds: [channel.sender_id] });
    case 'discord':
      return createDiscordAdapter({ botToken: channel.bot_token, publicKey: channel.webhook_secret,
        applicationId: channel.installation_id, userName });
    case 'whatsapp':
      if (!channel.verify_token) throw new Error('Missing WhatsApp verification token');
      return createWhatsAppAdapter({ accessToken: channel.bot_token, appSecret: channel.webhook_secret,
        phoneNumberId: channel.installation_id, verifyToken: channel.verify_token, userName });
    case 'slack':
      return createSlackAdapter({ botToken: channel.bot_token, signingSecret: channel.webhook_secret,
        botUserId: channel.installation_id.split(':')[1], userName });
  }
}
