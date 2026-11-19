create table if not exists agentops.company_members (
  company_id uuid not null references agentops.companies(id) on delete cascade,
  user_id uuid not null references agentops.users(id) on delete cascade,
  primary key (company_id, user_id)
);

create table if not exists agentops.conversation_activity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references agentops.companies(id),
  employee_id uuid not null,
  user_id uuid not null references agentops.users(id) on delete cascade,
  channel text not null check (channel in ('web', 'telegram')),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  foreign key (company_id, employee_id) references agentops.employees(company_id, id)
);
