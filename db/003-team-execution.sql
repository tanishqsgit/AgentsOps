create table if not exists agentops.teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references agentops.companies(id),
  name text not null,
  lead_employee_id uuid not null,
  employee_ids uuid[] not null,
  unique (company_id, id),
  foreign key (company_id, lead_employee_id) references agentops.employees(company_id, id),
  check (lead_employee_id = any(employee_ids))
);

alter table agentops.tasks add column if not exists team_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agentops.tasks'::regclass and conname = 'tasks_company_team_fk'
  ) then
    alter table agentops.tasks add constraint tasks_company_team_fk
      foreign key (company_id, team_id) references agentops.teams(company_id, id);
  end if;
end $$;

create table if not exists agentops.task_delegations (
  task_id uuid not null references agentops.tasks(id),
  tool_call_id text not null,
  employee_id uuid not null references agentops.employees(id),
  prompt text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  result text,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  primary key (task_id, tool_call_id)
);
