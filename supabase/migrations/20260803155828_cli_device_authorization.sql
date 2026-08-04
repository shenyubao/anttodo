create table anttodo_private.cli_device_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  device_code_hash text not null unique
    check (device_code_hash ~ '^[0-9a-f]{64}$'),
  user_code_hash text not null unique
    check (user_code_hash ~ '^[0-9a-f]{64}$'),
  client_public_key jsonb not null,
  client_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'consumed')),
  authorized_user_id uuid references auth.users(id) on delete cascade,
  encrypted_session jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  approved_at timestamptz,
  consumed_at timestamptz,
  last_polled_at timestamptz,
  check (
    (status = 'approved' and authorized_user_id is not null and encrypted_session is not null)
    or status <> 'approved'
  )
);

alter table anttodo_private.cli_device_authorizations enable row level security;
revoke all on table anttodo_private.cli_device_authorizations
from public, anon, authenticated;
grant select, insert, update, delete on table anttodo_private.cli_device_authorizations
to service_role;

create index cli_device_authorizations_expiry_idx
on anttodo_private.cli_device_authorizations(expires_at);

create or replace function anttodo_private.init_cli_device_authorization(
  p_device_code_hash text,
  p_user_code_hash text,
  p_public_key jsonb,
  p_client_metadata jsonb
)
returns table(request_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_device_code_hash !~ '^[0-9a-f]{64}$'
    or p_user_code_hash !~ '^[0-9a-f]{64}$'
    or p_public_key->>'kty' <> 'EC'
    or p_public_key->>'crv' <> 'P-256'
    or jsonb_typeof(p_public_key->'x') <> 'string'
    or jsonb_typeof(p_public_key->'y') <> 'string'
    or octet_length(p_public_key::text) > 2048
    or octet_length(coalesce(p_client_metadata, '{}'::jsonb)::text) > 2048
  then
    raise exception 'Invalid device authorization request' using errcode = '22023';
  end if;

  return query
  insert into anttodo_private.cli_device_authorizations(
    device_code_hash, user_code_hash, client_public_key, client_metadata
  ) values (
    p_device_code_hash, p_user_code_hash, p_public_key, coalesce(p_client_metadata, '{}'::jsonb)
  )
  returning id, cli_device_authorizations.expires_at;
end;
$$;

create or replace function anttodo_private.inspect_cli_device_authorization(
  p_user_code_hash text
)
returns table(
  request_id uuid,
  client_public_key jsonb,
  client_metadata jsonb,
  status text,
  expires_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select id, client_public_key, client_metadata, status, expires_at
  from anttodo_private.cli_device_authorizations
  where user_code_hash = p_user_code_hash
    and status = 'pending'
    and expires_at > now()
$$;

create or replace function anttodo_private.approve_cli_device_authorization(
  p_request_id uuid,
  p_user_code_hash text,
  p_user_id uuid,
  p_encrypted_session jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
    or jsonb_typeof(p_encrypted_session) <> 'object'
    or octet_length(p_encrypted_session::text) > 16384
  then
    raise exception 'Invalid approval payload' using errcode = '22023';
  end if;

  update anttodo_private.cli_device_authorizations
  set status = 'approved',
      authorized_user_id = p_user_id,
      encrypted_session = p_encrypted_session,
      approved_at = now()
  where id = p_request_id
    and user_code_hash = p_user_code_hash
    and status = 'pending'
    and expires_at > now();
  return found;
end;
$$;

create or replace function anttodo_private.deny_cli_device_authorization(
  p_request_id uuid,
  p_user_code_hash text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'Authenticated user required' using errcode = '42501';
  end if;
  update anttodo_private.cli_device_authorizations
  set status = 'denied', authorized_user_id = p_user_id, approved_at = now()
  where id = p_request_id
    and user_code_hash = p_user_code_hash
    and status = 'pending'
    and expires_at > now();
  return found;
end;
$$;

create or replace function anttodo_private.poll_cli_device_authorization(
  p_request_id uuid,
  p_device_code_hash text
)
returns table(
  status text,
  authorized_user_id uuid,
  encrypted_session jsonb,
  expires_at timestamptz,
  retry_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_row anttodo_private.cli_device_authorizations%rowtype;
begin
  select * into auth_row
  from anttodo_private.cli_device_authorizations
  where id = p_request_id
    and device_code_hash = p_device_code_hash
  for update;

  if not found then return; end if;
  if auth_row.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::jsonb,
      auth_row.expires_at, 0;
    return;
  end if;
  if auth_row.last_polled_at is not null
    and auth_row.last_polled_at > now() - interval '1 second'
  then
    return query select 'slow_down'::text, null::uuid, null::jsonb,
      auth_row.expires_at, 2;
    return;
  end if;

  update anttodo_private.cli_device_authorizations
  set last_polled_at = now()
  where id = auth_row.id;

  return query select auth_row.status, auth_row.authorized_user_id,
    case when auth_row.status = 'approved' then auth_row.encrypted_session else null end,
    auth_row.expires_at, 5;
end;
$$;

create or replace function anttodo_private.consume_cli_device_authorization(
  p_request_id uuid,
  p_device_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update anttodo_private.cli_device_authorizations
  set status = 'consumed',
      encrypted_session = null,
      consumed_at = now()
  where id = p_request_id
    and device_code_hash = p_device_code_hash
    and status = 'approved'
    and expires_at > now();
  return found;
end;
$$;

create or replace function anttodo_private.purge_cli_device_authorizations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from anttodo_private.cli_device_authorizations
  where expires_at < now()
    or consumed_at < now() - interval '5 minutes';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function anttodo_private.init_cli_device_authorization(text, text, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function anttodo_private.inspect_cli_device_authorization(text)
from public, anon, authenticated;
revoke all on function anttodo_private.approve_cli_device_authorization(uuid, text, uuid, jsonb)
from public, anon, authenticated;
revoke all on function anttodo_private.deny_cli_device_authorization(uuid, text, uuid)
from public, anon, authenticated;
revoke all on function anttodo_private.poll_cli_device_authorization(uuid, text)
from public, anon, authenticated;
revoke all on function anttodo_private.consume_cli_device_authorization(uuid, text)
from public, anon, authenticated;
revoke all on function anttodo_private.purge_cli_device_authorizations()
from public, anon, authenticated;

grant execute on function anttodo_private.init_cli_device_authorization(text, text, jsonb, jsonb)
to service_role;
grant execute on function anttodo_private.inspect_cli_device_authorization(text)
to service_role;
grant execute on function anttodo_private.approve_cli_device_authorization(uuid, text, uuid, jsonb)
to service_role;
grant execute on function anttodo_private.deny_cli_device_authorization(uuid, text, uuid)
to service_role;
grant execute on function anttodo_private.poll_cli_device_authorization(uuid, text)
to service_role;
grant execute on function anttodo_private.consume_cli_device_authorization(uuid, text)
to service_role;
grant execute on function anttodo_private.purge_cli_device_authorizations()
to service_role;

create or replace function public.cli_device_auth_init(
  p_device_code_hash text,
  p_user_code_hash text,
  p_public_key jsonb,
  p_client_metadata jsonb
)
returns table(request_id uuid, expires_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from anttodo_private.init_cli_device_authorization(
    p_device_code_hash, p_user_code_hash, p_public_key, p_client_metadata
  )
$$;

create or replace function public.cli_device_auth_inspect(p_user_code_hash text)
returns table(
  request_id uuid,
  client_public_key jsonb,
  client_metadata jsonb,
  status text,
  expires_at timestamptz
)
language sql security invoker set search_path = ''
as $$ select * from anttodo_private.inspect_cli_device_authorization(p_user_code_hash) $$;

create or replace function public.cli_device_auth_approve(
  p_request_id uuid, p_user_code_hash text, p_user_id uuid, p_encrypted_session jsonb
)
returns boolean
language sql security invoker set search_path = ''
as $$ select anttodo_private.approve_cli_device_authorization(
  p_request_id, p_user_code_hash, p_user_id, p_encrypted_session
) $$;

create or replace function public.cli_device_auth_deny(
  p_request_id uuid, p_user_code_hash text, p_user_id uuid
)
returns boolean
language sql security invoker set search_path = ''
as $$ select anttodo_private.deny_cli_device_authorization(
  p_request_id, p_user_code_hash, p_user_id
) $$;

create or replace function public.cli_device_auth_poll(
  p_request_id uuid, p_device_code_hash text
)
returns table(
  status text, authorized_user_id uuid, encrypted_session jsonb,
  expires_at timestamptz, retry_after integer
)
language sql security invoker set search_path = ''
as $$ select * from anttodo_private.poll_cli_device_authorization(
  p_request_id, p_device_code_hash
) $$;

create or replace function public.cli_device_auth_consume(
  p_request_id uuid, p_device_code_hash text
)
returns boolean
language sql security invoker set search_path = ''
as $$ select anttodo_private.consume_cli_device_authorization(
  p_request_id, p_device_code_hash
) $$;

revoke all on function public.cli_device_auth_init(text, text, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.cli_device_auth_inspect(text)
from public, anon, authenticated;
revoke all on function public.cli_device_auth_approve(uuid, text, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.cli_device_auth_deny(uuid, text, uuid)
from public, anon, authenticated;
revoke all on function public.cli_device_auth_poll(uuid, text)
from public, anon, authenticated;
revoke all on function public.cli_device_auth_consume(uuid, text)
from public, anon, authenticated;

grant execute on function public.cli_device_auth_init(text, text, jsonb, jsonb)
to service_role;
grant execute on function public.cli_device_auth_inspect(text)
to service_role;
grant execute on function public.cli_device_auth_approve(uuid, text, uuid, jsonb)
to service_role;
grant execute on function public.cli_device_auth_deny(uuid, text, uuid)
to service_role;
grant execute on function public.cli_device_auth_poll(uuid, text)
to service_role;
grant execute on function public.cli_device_auth_consume(uuid, text)
to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'anttodo-purge-cli-device-auth') then
      perform cron.unschedule('anttodo-purge-cli-device-auth');
    end if;
    perform cron.schedule(
      'anttodo-purge-cli-device-auth',
      '*/5 * * * *',
      'select anttodo_private.purge_cli_device_authorizations()'
    );
  end if;
end
$$;
