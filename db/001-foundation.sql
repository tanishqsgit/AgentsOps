create schema if not exists agentops;
create schema if not exists mastra;

create table if not exists agentops.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references agentops.users(id),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists agentops.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references agentops.companies(id),
  name text not null,
  role text not null,
  instructions text not null,
  unique (company_id, id)
);

create table if not exists agentops.tasks (
  id uuid primary key,
  company_id uuid not null,
  employee_id uuid not null,
  prompt text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  result text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (company_id, employee_id)
    references agentops.employees(company_id, id)
);
