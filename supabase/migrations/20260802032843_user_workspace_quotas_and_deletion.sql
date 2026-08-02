-- Add a single source of truth for per-user workspace ownership quotas and a
-- service-role-only workspace deletion primitive.

create table public.user_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_limit integer not null default 3 check (workspace_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.user_quotas (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create trigger user_quotas_updated_at
before update on public.user_quotas
for each row execute function anttodo_private.set_updated_at();

alter table public.user_quotas enable row level security;

create policy user_quotas_select_self
on public.user_quotas
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_quotas from public, anon, authenticated;
grant select on table public.user_quotas to authenticated;
grant all on table public.user_quotas to service_role;

create or replace function anttodo_private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_name text;
begin
  default_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(new.email, '@', 1), ''),
    case
      when new.phone ~ '^\+86[0-9]{11}$'
        then substring(new.phone from 4 for 3) || '****' || right(new.phone, 4)
      else nullif(new.phone, '')
    end,
    'AntTodo 用户'
  );

  insert into public.profiles (id, display_name)
  values (new.id, default_name)
  on conflict (id) do nothing;

  insert into public.user_quotas (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function anttodo_private.on_auth_user_created()
from public, anon, authenticated;

create or replace function anttodo_private.enforce_workspace_owner_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_count integer;
  owned_count integer;
begin
  if new.role <> 'owner' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.role = 'owner'
    and old.user_id = new.user_id
  then
    return new;
  end if;

  insert into public.user_quotas (user_id)
  values (new.user_id)
  on conflict (user_id) do nothing;

  select workspace_limit
  into allowed_count
  from public.user_quotas
  where user_id = new.user_id
  for update;

  select count(*)::integer
  into owned_count
  from public.workspace_members
  where user_id = new.user_id
    and role = 'owner'
    and workspace_id <> new.workspace_id;

  if owned_count >= allowed_count then
    raise exception using
      errcode = 'P0001',
      message = 'workspace_owner_quota_exceeded',
      detail = format('User may own at most %s workspaces.', allowed_count);
  end if;

  return new;
end;
$$;

revoke all on function anttodo_private.enforce_workspace_owner_quota()
from public, anon, authenticated;

create trigger workspace_members_enforce_owner_quota
before insert or update of user_id, role on public.workspace_members
for each row execute function anttodo_private.enforce_workspace_owner_quota();

create or replace function anttodo_private.prepare_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_workspace record;
  successor_id uuid;
  other_member_count integer;
begin
  for owned_workspace in
    select workspace_id
    from public.workspace_members
    where user_id = old.id
      and role = 'owner'
  loop
    select count(*)::integer
    into other_member_count
    from public.workspace_members
    where workspace_id = owned_workspace.workspace_id
      and user_id <> old.id;

    select member.user_id
    into successor_id
    from public.workspace_members member
    join public.user_quotas quota on quota.user_id = member.user_id
    where member.workspace_id = owned_workspace.workspace_id
      and member.user_id <> old.id
      and (
        select count(*)
        from public.workspace_members owned
        where owned.user_id = member.user_id
          and owned.role = 'owner'
      ) < quota.workspace_limit
    order by
      case member.role
        when 'admin' then 0
        when 'member' then 1
        else 2
      end,
      member.joined_at,
      member.user_id
    limit 1;

    if successor_id is null and other_member_count = 0 then
      delete from public.workspaces
      where id = owned_workspace.workspace_id;
    elsif successor_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'workspace_successor_quota_exceeded',
        detail = 'No workspace member has available ownership quota.';
    else
      update public.workspace_members
      set role = 'owner'
      where workspace_id = owned_workspace.workspace_id
        and user_id = successor_id;

      update public.workspaces
      set created_by = successor_id
      where id = owned_workspace.workspace_id
        and created_by = old.id;
    end if;
  end loop;

  return old;
end;
$$;

revoke all on function anttodo_private.prepare_account_deletion()
from public, anon, authenticated;

create or replace function public.delete_workspace_owned(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_confirmation_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_workspace public.workspaces%rowtype;
begin
  if p_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select *
  into selected_workspace
  from public.workspaces
  where id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  if selected_workspace.name <> p_confirmation_name then
    raise exception using errcode = '22023', message = 'workspace_confirmation_mismatch';
  end if;

  if not exists (
    select 1
    from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_actor_id
      and role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'workspace_owner_required';
  end if;

  delete from vault.secrets
  where id in (
    select credential_secret_id
    from public.connector_instances
    where workspace_id = p_workspace_id
      and credential_secret_id is not null
    union
    select credential_secret_id
    from public.workspace_sso_providers
    where workspace_id = p_workspace_id
      and credential_secret_id is not null
  );

  delete from public.workspaces
  where id = p_workspace_id;

  return true;
end;
$$;

revoke all on function public.delete_workspace_owned(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.delete_workspace_owned(uuid, uuid, text)
to service_role;
