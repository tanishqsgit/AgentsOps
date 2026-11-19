create schema if not exists agentops;

create table if not exists agentops.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz
);

do $$
begin
  if to_regclass('auth.users') is not null then
    insert into agentops.users (id, email, email_confirmed_at)
    select id, email, email_confirmed_at from auth.users
    on conflict (id) do nothing;
  end if;
end $$;
