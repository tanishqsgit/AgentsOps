alter table agentops.company_settings add column if not exists sandbox_api_key text;
alter table agentops.company_channels add column if not exists verify_token text;

alter table agentops.company_channels drop constraint if exists company_channels_platform_check;
alter table agentops.company_channels add constraint company_channels_platform_check
  check (platform in ('telegram', 'slack', 'discord', 'whatsapp'));

alter table agentops.conversation_activity drop constraint if exists conversation_activity_channel_check;
alter table agentops.conversation_activity add constraint conversation_activity_channel_check
  check (channel in ('web', 'telegram', 'slack', 'discord', 'whatsapp'));
