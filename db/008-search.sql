alter table agentops.company_settings
  add column if not exists search_provider text,
  add column if not exists search_api_key text;
