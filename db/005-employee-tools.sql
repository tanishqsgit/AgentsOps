alter table agentops.employees
  add column if not exists tool_ids text[] not null default '{}';

alter table agentops.teams alter column lead_employee_id drop not null;
