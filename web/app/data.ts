export type Company = { id: string; name: string; access: 'owner' | 'member' };
export type Employee = { id: string; name: string; role: string; instructions: string; tool_ids: string[] };
export type Team = { id: string; name: string; lead_employee_id: string | null; employee_ids: string[] };
export type Member = { id: string; email: string; role: 'owner' | 'member' };
export type Brief = { title: string; summary: string; changes: string[] };
export type Task = {
  id: string; employee_id: string; team_id: string | null; prompt: string; status: string;
  output_format: 'text' | 'release_brief'; result: string | null; result_data: Brief | null;
  error: string | null; created_at: string; finished_at: string | null;
};
export type Delegation = {
  tool_call_id: string; employee_id: string; prompt: string; status: string; result: string | null;
};
export type Activity = {
  id: string; employee_id: string; task_id: string | null; status: string; started_at: string;
  can_open_chat: boolean;
  kind: 'task' | 'delegation' | 'web' | 'telegram' | 'slack' | 'discord' | 'whatsapp' | 'review';
};
export type Review = { status: string; decision: { approved: boolean; reviewerId: string; note?: string } | null; createdAt: string; updatedAt: string; step: string | null };
export type Message = { id: string; role: 'assistant' | 'user'; text: string; createdAt?: string; parts?: UIMessage['parts'] };
export type ChannelThread = { employeeId: string; messages: Message[] };
export type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

export function employeeActivity(activity: Activity[], employeeId: string) {
  const events = activity.filter(event => event.employee_id === employeeId);
  return events.find(event => event.status === 'running') ?? events[0];
}

export function employeeStatus(event?: Activity) {
  if (event?.status === 'awaiting approval') return 'Awaiting approval';
  if (event?.status === 'failed') return 'Failed';
  if (event?.status !== 'running') return 'Idle';
  return event.kind === 'delegation' ? 'Delegated work' : 'Working';
}

export const dateLabel = (date: string) => new Date(date).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
import type { UIMessage } from 'ai';

export const channelNames = { telegram: 'Telegram', slack: 'Slack', discord: 'Discord', whatsapp: 'WhatsApp' } as const;
