create table if not exists agentops.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references agentops.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  content_hash text not null,
  chunk_count integer not null check (chunk_count between 1 and 400),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, content_hash)
);

create table if not exists agentops.knowledge_chunks (
  company_id uuid not null,
  source_id uuid not null,
  position integer not null,
  page integer,
  excerpt text not null check (char_length(excerpt) between 1 and 900),
  search_vector tsvector generated always as (to_tsvector('english'::regconfig, excerpt)) stored,
  primary key (company_id, source_id, position),
  foreign key (company_id, source_id) references agentops.knowledge_sources(company_id, id) on delete cascade
);

create index if not exists knowledge_chunks_search on agentops.knowledge_chunks using gin (search_vector);
