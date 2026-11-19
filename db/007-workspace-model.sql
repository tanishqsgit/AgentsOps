alter table agentops.company_settings
  add column if not exists model_id text,
  add column if not exists model_api_key text;
