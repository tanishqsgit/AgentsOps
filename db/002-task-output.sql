alter table agentops.tasks
  add column if not exists output_format text not null default 'text'
    check (output_format in ('text', 'release_brief')),
  add column if not exists result_data jsonb;
