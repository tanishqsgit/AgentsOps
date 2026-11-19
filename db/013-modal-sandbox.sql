alter table agentops.company_settings
  add column if not exists sandbox_modal_token_id text,
  add column if not exists sandbox_modal_token_secret text;
