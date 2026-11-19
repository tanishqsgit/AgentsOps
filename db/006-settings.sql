create table if not exists agentops.company_settings (
  company_id uuid primary key references agentops.companies(id) on delete cascade,
  mistral_api_key text,
  connect_project_id text,
  connect_access_token text
);

create table if not exists agentops.company_channels (
  company_id uuid not null references agentops.companies(id) on delete cascade,
  platform text not null check (platform in ('telegram', 'slack')),
  employee_id uuid not null,
  sender_id text not null,
  installation_id text not null,
  bot_name text not null,
  bot_token text not null,
  webhook_secret text not null,
  webhook_url text,
  updated_at timestamptz not null default now(),
  primary key (company_id, platform),
  unique (platform, installation_id),
  foreign key (company_id, employee_id) references agentops.employees(company_id, id)
);

alter table agentops.conversation_activity drop constraint if exists conversation_activity_channel_check;
alter table agentops.conversation_activity add constraint conversation_activity_channel_check
  check (channel in ('web', 'telegram', 'slack', 'discord', 'whatsapp'));
