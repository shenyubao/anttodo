create table public.workspace_sso_providers (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('dingtalk')),
  enabled boolean not null default true,
  public_config jsonb not null default '{}'::jsonb,
  credential_secret_id uuid,
  credential_hint text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider),
  constraint workspace_sso_providers_dingtalk_config_check check (
    provider <> 'dingtalk'
    or (
      char_length(trim(coalesce(public_config->>'corpId', ''))) > 0
      and char_length(trim(coalesce(public_config->>'appKey', ''))) > 0
    )
  )
);

create unique index workspace_sso_providers_dingtalk_corpid_uidx
  on public.workspace_sso_providers (lower(public_config->>'corpId'))
  where provider = 'dingtalk' and enabled;

create index workspace_sso_providers_workspace_idx
  on public.workspace_sso_providers (workspace_id);

create table public.sso_identities (
  provider text not null check (provider in ('dingtalk')),
  subject text not null check (char_length(trim(subject)) > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  last_workspace_id uuid references public.workspaces(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index sso_identities_user_idx on public.sso_identities (user_id);

create trigger workspace_sso_providers_set_updated_at
before update on public.workspace_sso_providers
for each row execute function anttodo_private.set_updated_at();

create trigger sso_identities_set_updated_at
before update on public.sso_identities
for each row execute function anttodo_private.set_updated_at();

alter table public.workspace_sso_providers enable row level security;
alter table public.sso_identities enable row level security;

revoke all on table public.workspace_sso_providers from public, anon, authenticated;
revoke all on table public.sso_identities from public, anon, authenticated;

grant select, insert, update, delete on table public.workspace_sso_providers
  to authenticated;
grant select on table public.sso_identities to authenticated;
grant select, insert, update, delete on table public.workspace_sso_providers
  to service_role;
grant select, insert, update, delete on table public.sso_identities
  to service_role;

create policy workspace_sso_providers_select
on public.workspace_sso_providers
for select to authenticated
using ((select anttodo_private.is_workspace_member(workspace_id)));

create policy workspace_sso_providers_insert
on public.workspace_sso_providers
for insert to authenticated
with check ((select anttodo_private.is_workspace_admin(workspace_id)));

create policy workspace_sso_providers_update
on public.workspace_sso_providers
for update to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)))
with check ((select anttodo_private.is_workspace_admin(workspace_id)));

create policy workspace_sso_providers_delete
on public.workspace_sso_providers
for delete to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));

create policy sso_identities_select_own
on public.sso_identities
for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.set_sso_provider_secret(
  p_provider_id uuid,
  p_actor_id uuid,
  p_secret text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_secret_id uuid;
  v_hint text;
begin
  if char_length(trim(p_secret)) = 0 or char_length(p_secret) > 10000 then
    raise exception 'Invalid SSO secret';
  end if;

  select workspace_id, credential_secret_id
    into v_workspace_id, v_secret_id
  from public.workspace_sso_providers
  where id = p_provider_id;

  if v_workspace_id is null or not exists (
    select 1
    from public.workspace_members
    where workspace_id = v_workspace_id
      and user_id = p_actor_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'SSO administrator access required';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'anttodo_sso_' || p_provider_id::text,
      'AntTodo SSO credential'
    );
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;

  v_hint := '••••' || right(p_secret, 4);
  update public.workspace_sso_providers
  set credential_secret_id = v_secret_id,
      credential_hint = v_hint
  where id = p_provider_id;

  return v_hint;
end;
$$;

create or replace function public.delete_sso_provider_secret(
  p_provider_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_secret_id uuid;
begin
  select workspace_id, credential_secret_id
    into v_workspace_id, v_secret_id
  from public.workspace_sso_providers
  where id = p_provider_id;

  if v_workspace_id is null or not exists (
    select 1
    from public.workspace_members
    where workspace_id = v_workspace_id
      and user_id = p_actor_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'SSO administrator access required';
  end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  update public.workspace_sso_providers
  set credential_secret_id = null,
      credential_hint = null
  where id = p_provider_id;

  return true;
end;
$$;

create or replace function public.get_sso_provider_secret(p_provider_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select credential_secret_id
    into v_secret_id
  from public.workspace_sso_providers
  where id = p_provider_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_secret;
end;
$$;

create or replace function anttodo_private.find_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where phone = p_phone
  limit 1;
$$;

create or replace function public.find_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select anttodo_private.find_user_id_by_phone(p_phone);
$$;

revoke all on function public.set_sso_provider_secret(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_sso_provider_secret(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_sso_provider_secret(uuid)
  from public, anon, authenticated;
revoke all on function public.find_user_id_by_phone(text)
  from public, anon, authenticated;
revoke all on function anttodo_private.find_user_id_by_phone(text)
  from public, anon, authenticated;

grant execute on function public.set_sso_provider_secret(uuid, uuid, text)
  to service_role;
grant execute on function public.delete_sso_provider_secret(uuid, uuid)
  to service_role;
grant execute on function public.get_sso_provider_secret(uuid)
  to service_role;
grant execute on function public.find_user_id_by_phone(text)
  to service_role;
