do $$
begin
  if to_regclass('auth.users') is not null then
    if exists (select 1 from pg_constraint where conrelid = 'agentops.companies'::regclass and confrelid = 'auth.users'::regclass) then
      alter table agentops.companies drop constraint companies_owner_id_fkey,
        add constraint companies_owner_id_fkey foreign key (owner_id) references agentops.users(id);
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'agentops.company_members'::regclass and confrelid = 'auth.users'::regclass) then
      alter table agentops.company_members drop constraint company_members_user_id_fkey,
        add constraint company_members_user_id_fkey foreign key (user_id) references agentops.users(id) on delete cascade;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'agentops.conversation_activity'::regclass and confrelid = 'auth.users'::regclass) then
      alter table agentops.conversation_activity drop constraint conversation_activity_user_id_fkey,
        add constraint conversation_activity_user_id_fkey foreign key (user_id) references agentops.users(id) on delete cascade;
    end if;
  end if;
end $$;
