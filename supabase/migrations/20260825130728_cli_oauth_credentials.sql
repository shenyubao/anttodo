-- CLI device authorization protocol v2.
-- The CLI keeps only a random device credential. OAuth refresh tokens and PKCE
-- verifiers are stored in Vault and are only readable by service-role RPCs.

update anttodo_private.cli_device_authorizations
set status = 'denied', expires_at = least(expires_at, now())
where status = 'pending';

alter table anttodo_private.cli_device_authorizations
  alter column client_public_key drop not null,
  add column protocol_version smallint not null default 2,
  add column oauth_state_hash text,
  add column consent_nonce_hash text,
  add column oauth_authorization_id text,
  add column pkce_verifier_secret_id uuid,
  add column credential_expires_at timestamptz;

alter table anttodo_private.cli_device_authorizations
  drop constraint if exists cli_device_authorizations_status_check;
alter table anttodo_private.cli_device_authorizations
  add constraint cli_device_authorizations_status_check
  check (status in ('pending', 'authorizing', 'approved', 'denied', 'consumed'));

alter table anttodo_private.cli_device_authorizations
  drop constraint if exists cli_device_authorizations_check;

create table anttodo_private.cli_oauth_clients (
  client_id uuid primary key,
  created_at timestamptz not null default now()
);

create table anttodo_private.cli_credentials (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_hash text not null check (credential_hash ~ '^[0-9a-f]{64}$'),
  client_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  oauth_bundle_secret_id uuid not null,
  oauth_session_id uuid not null,
  oauth_client_id uuid not null,
  access_expires_at timestamptz not null,
  refresh_lease_id uuid,
  refresh_lease_expires_at timestamptz,
  constraint cli_credentials_hash_unique unique (id, credential_hash),
  constraint cli_credentials_metadata_size check (octet_length(client_metadata::text) <= 2048),
  constraint cli_credentials_expiry check (expires_at is null or expires_at > created_at)
);

alter table anttodo_private.cli_oauth_clients enable row level security;
alter table anttodo_private.cli_credentials enable row level security;
revoke all on table anttodo_private.cli_oauth_clients, anttodo_private.cli_credentials
from public, anon, authenticated;
grant select, insert, update, delete on table anttodo_private.cli_oauth_clients,
  anttodo_private.cli_credentials to service_role;

create index cli_credentials_user_active_idx
on anttodo_private.cli_credentials(user_id, last_used_at desc nulls last, created_at desc)
where revoked_at is null;

create index cli_credentials_expiry_idx
on anttodo_private.cli_credentials(expires_at)
where revoked_at is null and expires_at is not null;

create index cli_credentials_oauth_session_idx
on anttodo_private.cli_credentials(oauth_session_id);

create unique index cli_device_authorizations_oauth_state_idx
on anttodo_private.cli_device_authorizations(oauth_state_hash)
where oauth_state_hash is not null;

create index cli_device_authorizations_user_expiry_idx
on anttodo_private.cli_device_authorizations(authorized_user_id, expires_at)
where status in ('pending', 'authorizing');

create or replace function anttodo_private.cli_expiry(
  p_lifetime text,
  p_started_at timestamptz default now()
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case p_lifetime
    when '7' then p_started_at + interval '7 days'
    when '90' then p_started_at + interval '90 days'
    when '360' then p_started_at + interval '360 days'
    when 'unlimited' then null
    else 'infinity'::timestamptz
  end
$$;

create or replace function anttodo_private.init_cli_device_authorization_v2(
  p_device_code_hash text,
  p_user_code_hash text,
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
    or octet_length(coalesce(p_client_metadata, '{}'::jsonb)::text) > 2048
  then
    raise exception using errcode = '22023', message = 'invalid_device_authorization_request';
  end if;

  return query
  insert into anttodo_private.cli_device_authorizations(
    device_code_hash, user_code_hash, client_metadata, protocol_version
  ) values (
    p_device_code_hash, p_user_code_hash, coalesce(p_client_metadata, '{}'::jsonb), 2
  ) returning id, cli_device_authorizations.expires_at;
end;
$$;

create or replace function anttodo_private.inspect_cli_device_authorization_v2(
  p_user_code_hash text
)
returns table(request_id uuid, client_metadata jsonb, status text, expires_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select id, client_metadata, status, expires_at
  from anttodo_private.cli_device_authorizations
  where user_code_hash = p_user_code_hash
    and protocol_version = 2
    and status = 'pending'
    and expires_at > now()
$$;

create or replace function anttodo_private.authorize_cli_device_v2(
  p_request_id uuid,
  p_user_code_hash text,
  p_user_id uuid,
  p_lifetime text,
  p_state_hash text,
  p_nonce_hash text,
  p_pkce_verifier text
)
returns table(credential_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expiry timestamptz;
  v_secret_id uuid;
begin
  if p_user_id is null or p_lifetime not in ('7', '90', '360', 'unlimited')
    or p_state_hash !~ '^[0-9a-f]{64}$' or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or char_length(p_pkce_verifier) < 43 or char_length(p_pkce_verifier) > 128
  then
    raise exception using errcode = '22023', message = 'invalid_cli_authorization';
  end if;
  v_expiry := anttodo_private.cli_expiry(p_lifetime, now());
  perform id
  from anttodo_private.cli_device_authorizations
  where id = p_request_id and user_code_hash = p_user_code_hash
    and protocol_version = 2 and status = 'pending' and expires_at > now()
  for update;
  if not found then return; end if;
  v_secret_id := vault.create_secret(
    p_pkce_verifier,
    'anttodo_cli_pkce_' || p_request_id::text,
    'AntTodo CLI OAuth PKCE verifier'
  );
  update anttodo_private.cli_device_authorizations
  set status = 'authorizing', authorized_user_id = p_user_id,
      oauth_state_hash = p_state_hash, consent_nonce_hash = p_nonce_hash,
      pkce_verifier_secret_id = v_secret_id, credential_expires_at = v_expiry,
      approved_at = now()
  where id = p_request_id and user_code_hash = p_user_code_hash
    and protocol_version = 2 and status = 'pending' and expires_at > now();
  return query select v_expiry;
end;
$$;

create or replace function anttodo_private.bind_cli_oauth_authorization_v2(
  p_request_id uuid,
  p_user_id uuid,
  p_nonce_hash text,
  p_authorization_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or char_length(p_authorization_id) < 8 then
    return false;
  end if;
  update anttodo_private.cli_device_authorizations
  set oauth_authorization_id = p_authorization_id, consent_nonce_hash = null
  where id = p_request_id and authorized_user_id = p_user_id
    and consent_nonce_hash = p_nonce_hash and status = 'authorizing'
    and expires_at > now() and oauth_authorization_id is null;
  return found;
end;
$$;

create or replace function anttodo_private.cli_oauth_callback_context_v2(
  p_state_hash text
)
returns table(
  request_id uuid,
  user_id uuid,
  credential_hash text,
  credential_expires_at timestamptz,
  pkce_verifier text,
  client_metadata jsonb
)
language sql
security definer
set search_path = ''
as $$
  select request.id, request.authorized_user_id, request.device_code_hash,
    request.credential_expires_at, secret.decrypted_secret, request.client_metadata
  from anttodo_private.cli_device_authorizations request
  join vault.decrypted_secrets secret on secret.id = request.pkce_verifier_secret_id
  where request.oauth_state_hash = p_state_hash and request.status = 'authorizing'
    and request.expires_at > now()
$$;

create or replace function anttodo_private.complete_cli_oauth_callback_v2(
  p_request_id uuid,
  p_user_id uuid,
  p_oauth_client_id uuid,
  p_oauth_session_id uuid,
  p_access_expires_at timestamptz,
  p_token_bundle jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request anttodo_private.cli_device_authorizations%rowtype;
  v_bundle_secret_id uuid;
begin
  if jsonb_typeof(p_token_bundle) <> 'object' or octet_length(p_token_bundle::text) > 32768
    or p_access_expires_at <= now() or not exists (
      select 1 from anttodo_private.cli_oauth_clients where client_id = p_oauth_client_id
    )
  then
    raise exception using errcode = '22023', message = 'invalid_oauth_token_bundle';
  end if;
  select * into v_request from anttodo_private.cli_device_authorizations
  where id = p_request_id and status = 'authorizing' and authorized_user_id = p_user_id
    and expires_at > now() for update;
  if not found then return false; end if;
  v_bundle_secret_id := vault.create_secret(
    p_token_bundle::text,
    'anttodo_cli_oauth_' || p_request_id::text,
    'AntTodo CLI OAuth token bundle'
  );
  insert into anttodo_private.cli_credentials(
    id, user_id, credential_hash, client_metadata, expires_at,
    oauth_bundle_secret_id, oauth_session_id, oauth_client_id, access_expires_at
  ) values (
    v_request.id, p_user_id, v_request.device_code_hash, v_request.client_metadata,
    v_request.credential_expires_at, v_bundle_secret_id, p_oauth_session_id,
    p_oauth_client_id, p_access_expires_at
  );
  delete from vault.secrets where id = v_request.pkce_verifier_secret_id;
  update anttodo_private.cli_device_authorizations
  set status = 'approved', pkce_verifier_secret_id = null, oauth_state_hash = null
  where id = p_request_id;
  return true;
exception when others then
  if v_bundle_secret_id is not null then delete from vault.secrets where id = v_bundle_secret_id; end if;
  raise;
end;
$$;

create or replace function anttodo_private.poll_cli_device_authorization_v2(
  p_request_id uuid,
  p_device_code_hash text
)
returns table(status text, user_id uuid, expires_at timestamptz, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request anttodo_private.cli_device_authorizations%rowtype;
begin
  select * into v_request from anttodo_private.cli_device_authorizations
  where id = p_request_id and device_code_hash = p_device_code_hash and protocol_version = 2
  for update;
  if not found then return; end if;
  if v_request.expires_at <= now() then
    return query select 'expired'::text, null::uuid, v_request.expires_at, 0;
    return;
  end if;
  if v_request.last_polled_at > now() - interval '1 second' then
    return query select 'slow_down'::text, null::uuid, v_request.expires_at, 2;
    return;
  end if;
  update anttodo_private.cli_device_authorizations set last_polled_at = now() where id = v_request.id;
  return query select v_request.status,
    case when v_request.status = 'approved' then v_request.authorized_user_id else null end,
    v_request.credential_expires_at, 5;
end;
$$;

create or replace function anttodo_private.consume_cli_device_authorization_v2(
  p_request_id uuid,
  p_device_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update anttodo_private.cli_device_authorizations set status = 'consumed', consumed_at = now()
  where id = p_request_id and device_code_hash = p_device_code_hash
    and status = 'approved' and expires_at > now();
  return found;
end;
$$;

create or replace function anttodo_private.begin_cli_token_exchange_v2(
  p_credential_id uuid,
  p_credential_hash text,
  p_lease_id uuid
)
returns table(
  user_id uuid,
  token_bundle jsonb,
  access_expires_at timestamptz,
  credential_expires_at timestamptz,
  refresh_required boolean,
  lease_acquired boolean,
  retry_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential anttodo_private.cli_credentials%rowtype;
  v_bundle jsonb;
  v_acquired boolean := false;
begin
  select * into v_credential from anttodo_private.cli_credentials
  where id = p_credential_id and credential_hash = p_credential_hash for update;
  if not found or v_credential.revoked_at is not null
    or (v_credential.expires_at is not null and v_credential.expires_at <= now())
  then return; end if;
  select decrypted_secret::jsonb into v_bundle from vault.decrypted_secrets
  where id = v_credential.oauth_bundle_secret_id;
  if v_credential.access_expires_at <= now() + interval '60 seconds' then
    if v_credential.refresh_lease_expires_at is null or v_credential.refresh_lease_expires_at <= now() then
      update anttodo_private.cli_credentials
      set refresh_lease_id = p_lease_id, refresh_lease_expires_at = now() + interval '30 seconds',
          last_used_at = now()
      where id = v_credential.id;
      v_acquired := true;
    end if;
  else
    update anttodo_private.cli_credentials set last_used_at = now() where id = v_credential.id;
  end if;
  return query select v_credential.user_id, v_bundle, v_credential.access_expires_at,
    v_credential.expires_at, v_credential.access_expires_at <= now() + interval '60 seconds',
    v_acquired, case when v_acquired then 0 else 2 end;
end;
$$;

create or replace function anttodo_private.complete_cli_token_refresh_v2(
  p_credential_id uuid,
  p_lease_id uuid,
  p_access_expires_at timestamptz,
  p_token_bundle jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  update anttodo_private.cli_credentials
  set access_expires_at = p_access_expires_at, refresh_lease_id = null,
      refresh_lease_expires_at = null, last_used_at = now()
  where id = p_credential_id and refresh_lease_id = p_lease_id
    and refresh_lease_expires_at > now()
  returning oauth_bundle_secret_id into v_secret_id;
  if not found then return false; end if;
  perform vault.update_secret(v_secret_id, p_token_bundle::text);
  return true;
end;
$$;

create or replace function anttodo_private.abort_cli_token_refresh_v2(
  p_credential_id uuid,
  p_lease_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update anttodo_private.cli_credentials
  set refresh_lease_id = null, refresh_lease_expires_at = null
  where id = p_credential_id and refresh_lease_id = p_lease_id
  returning true
$$;

create or replace function anttodo_private.list_cli_credentials_v2(p_user_id uuid)
returns table(
  id uuid,
  client_metadata jsonb,
  created_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  return query select credential.id, credential.client_metadata, credential.created_at,
    credential.last_used_at, credential.expires_at
  from anttodo_private.cli_credentials credential
  where credential.user_id = p_user_id and credential.revoked_at is null
    and (credential.expires_at is null or credential.expires_at > now())
  order by coalesce(credential.last_used_at, credential.created_at) desc;
end;
$$;

create or replace function anttodo_private.cli_credential_for_revoke_v2(
  p_credential_id uuid,
  p_user_id uuid default null,
  p_credential_hash text default null
)
returns table(token_bundle jsonb)
language sql
security definer
set search_path = ''
as $$
  select secret.decrypted_secret::jsonb
  from anttodo_private.cli_credentials credential
  join vault.decrypted_secrets secret on secret.id = credential.oauth_bundle_secret_id
  where credential.id = p_credential_id and credential.revoked_at is null
    and ((p_user_id is not null and credential.user_id = p_user_id)
      or (p_credential_hash is not null and credential.credential_hash = p_credential_hash))
$$;

create or replace function anttodo_private.revoke_cli_credential_v2(
  p_credential_id uuid,
  p_user_id uuid default null,
  p_credential_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  update anttodo_private.cli_credentials
  set revoked_at = now(), refresh_lease_id = null, refresh_lease_expires_at = null
  where id = p_credential_id and revoked_at is null
    and ((p_user_id is not null and user_id = p_user_id)
      or (p_credential_hash is not null and credential_hash = p_credential_hash))
  returning oauth_bundle_secret_id into v_secret_id;
  if not found then return false; end if;
  delete from vault.secrets where id = v_secret_id;
  return true;
end;
$$;

create or replace function anttodo_private.deny_cli_device_authorization_v2(
  p_request_id uuid,
  p_user_code_hash text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_secret_id uuid;
begin
  select pkce_verifier_secret_id into v_secret_id
  from anttodo_private.cli_device_authorizations
  where id = p_request_id and user_code_hash = p_user_code_hash
    and status in ('pending', 'authorizing') and expires_at > now();
  update anttodo_private.cli_device_authorizations
  set status = 'denied', authorized_user_id = p_user_id, approved_at = now(),
      pkce_verifier_secret_id = null
  where id = p_request_id and user_code_hash = p_user_code_hash
    and status in ('pending', 'authorizing') and expires_at > now();
  if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
  return found;
end;
$$;

create or replace function anttodo_private.purge_cli_auth_v2()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer; v_authorization_count integer; v_secret_ids uuid[];
begin
  select array_agg(secret_id) into v_secret_ids from (
    select pkce_verifier_secret_id secret_id
    from anttodo_private.cli_device_authorizations
    where expires_at < now() and pkce_verifier_secret_id is not null
    union all
    select oauth_bundle_secret_id
    from anttodo_private.cli_credentials
    where (expires_at is not null and expires_at < now())
      or (revoked_at is not null and revoked_at < now() - interval '15 minutes')
  ) secrets;
  if v_secret_ids is not null then delete from vault.secrets where id = any(v_secret_ids); end if;
  delete from anttodo_private.cli_credentials
  where (expires_at is not null and expires_at < now() - interval '15 minutes')
    or (revoked_at is not null and revoked_at < now() - interval '15 minutes');
  get diagnostics v_count = row_count;
  delete from anttodo_private.cli_device_authorizations
  where expires_at < now() - interval '15 minutes'
    or consumed_at < now() - interval '5 minutes';
  get diagnostics v_authorization_count = row_count;
  v_count := v_count + v_authorization_count;
  return v_count;
end;
$$;

create or replace function anttodo_private.cleanup_cli_credentials_on_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id in (
    select oauth_bundle_secret_id from anttodo_private.cli_credentials where user_id = old.id
    union all
    select pkce_verifier_secret_id from anttodo_private.cli_device_authorizations
      where authorized_user_id = old.id and pkce_verifier_secret_id is not null
  );
  return old;
end;
$$;

create trigger cleanup_cli_credentials_before_user_delete
before delete on auth.users
for each row execute function anttodo_private.cleanup_cli_credentials_on_user_delete();

create or replace function anttodo_private.cli_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_claims jsonb; v_client_id uuid; v_iat bigint; v_exp bigint;
begin
  v_claims := event->'claims';
  begin v_client_id := (v_claims->>'client_id')::uuid; exception when others then v_client_id := null; end;
  if v_client_id is not null and exists (
    select 1 from anttodo_private.cli_oauth_clients where client_id = v_client_id
  ) then
    v_iat := (v_claims->>'iat')::bigint;
    v_exp := least((v_claims->>'exp')::bigint, v_iat + 900);
    v_claims := jsonb_set(v_claims, '{exp}', to_jsonb(v_exp));
  end if;
  return jsonb_build_object('claims', v_claims);
end;
$$;

-- Public RPCs are an API boundary for the Edge Function only.
create or replace function public.cli_device_auth_init_v2(p_device_code_hash text, p_user_code_hash text, p_client_metadata jsonb)
returns table(request_id uuid, expires_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from anttodo_private.init_cli_device_authorization_v2(p_device_code_hash, p_user_code_hash, p_client_metadata) $$;
create or replace function public.cli_device_auth_inspect_v2(p_user_code_hash text)
returns table(request_id uuid, client_metadata jsonb, status text, expires_at timestamptz)
language sql security invoker stable set search_path = ''
as $$ select * from anttodo_private.inspect_cli_device_authorization_v2(p_user_code_hash) $$;
create or replace function public.cli_device_auth_authorize_v2(p_request_id uuid,p_user_code_hash text,p_user_id uuid,p_lifetime text,p_state_hash text,p_nonce_hash text,p_pkce_verifier text)
returns table(credential_expires_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from anttodo_private.authorize_cli_device_v2(p_request_id,p_user_code_hash,p_user_id,p_lifetime,p_state_hash,p_nonce_hash,p_pkce_verifier) $$;
create or replace function public.cli_device_auth_bind_oauth_v2(p_request_id uuid,p_user_id uuid,p_nonce_hash text,p_authorization_id text)
returns boolean language sql security invoker set search_path = ''
as $$ select anttodo_private.bind_cli_oauth_authorization_v2(p_request_id,p_user_id,p_nonce_hash,p_authorization_id) $$;
create or replace function public.cli_device_auth_callback_v2(p_state_hash text)
returns table(request_id uuid,user_id uuid,credential_hash text,credential_expires_at timestamptz,pkce_verifier text,client_metadata jsonb)
language sql security invoker set search_path = ''
as $$ select * from anttodo_private.cli_oauth_callback_context_v2(p_state_hash) $$;
create or replace function public.cli_device_auth_complete_v2(p_request_id uuid,p_user_id uuid,p_oauth_client_id uuid,p_oauth_session_id uuid,p_access_expires_at timestamptz,p_token_bundle jsonb)
returns boolean language sql security invoker set search_path = ''
as $$ select anttodo_private.complete_cli_oauth_callback_v2(p_request_id,p_user_id,p_oauth_client_id,p_oauth_session_id,p_access_expires_at,p_token_bundle) $$;
create or replace function public.cli_device_auth_poll_v2(p_request_id uuid,p_device_code_hash text)
returns table(status text,user_id uuid,expires_at timestamptz,retry_after integer)
language sql security invoker set search_path = ''
as $$ select * from anttodo_private.poll_cli_device_authorization_v2(p_request_id,p_device_code_hash) $$;
create or replace function public.cli_device_auth_consume_v2(p_request_id uuid,p_device_code_hash text)
returns boolean language sql security invoker set search_path = ''
as $$ select anttodo_private.consume_cli_device_authorization_v2(p_request_id,p_device_code_hash) $$;
create or replace function public.cli_device_auth_exchange_v2(p_credential_id uuid,p_credential_hash text,p_lease_id uuid)
returns table(user_id uuid,token_bundle jsonb,access_expires_at timestamptz,credential_expires_at timestamptz,refresh_required boolean,lease_acquired boolean,retry_after integer)
language sql security invoker set search_path = ''
as $$ select * from anttodo_private.begin_cli_token_exchange_v2(p_credential_id,p_credential_hash,p_lease_id) $$;
create or replace function public.cli_device_auth_refresh_v2(p_credential_id uuid,p_lease_id uuid,p_access_expires_at timestamptz,p_token_bundle jsonb)
returns boolean language sql security invoker set search_path = ''
as $$ select anttodo_private.complete_cli_token_refresh_v2(p_credential_id,p_lease_id,p_access_expires_at,p_token_bundle) $$;
create or replace function public.cli_device_auth_abort_refresh_v2(p_credential_id uuid,p_lease_id uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select anttodo_private.abort_cli_token_refresh_v2(p_credential_id,p_lease_id) $$;
create or replace function public.cli_device_auth_list_v2(p_user_id uuid)
returns table(id uuid,client_metadata jsonb,created_at timestamptz,last_used_at timestamptz,expires_at timestamptz)
language sql security invoker stable set search_path = ''
as $$ select * from anttodo_private.list_cli_credentials_v2(p_user_id) $$;
create or replace function public.cli_device_auth_revoke_context_v2(p_credential_id uuid,p_user_id uuid,p_credential_hash text)
returns table(token_bundle jsonb) language sql security invoker set search_path = ''
as $$ select * from anttodo_private.cli_credential_for_revoke_v2(p_credential_id,p_user_id,p_credential_hash) $$;
create or replace function public.cli_device_auth_revoke_v2(p_credential_id uuid,p_user_id uuid,p_credential_hash text)
returns boolean language sql security invoker set search_path = ''
as $$ select anttodo_private.revoke_cli_credential_v2(p_credential_id,p_user_id,p_credential_hash) $$;
create or replace function public.cli_device_auth_deny_v2(p_request_id uuid,p_user_code_hash text,p_user_id uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select anttodo_private.deny_cli_device_authorization_v2(p_request_id,p_user_code_hash,p_user_id) $$;
create or replace function public.cli_device_auth_register_client_v2(p_client_id uuid)
returns void language sql security definer set search_path = ''
as $$ insert into anttodo_private.cli_oauth_clients(client_id) values (p_client_id) on conflict do nothing $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'anttodo_private' and p.proname like '%cli%v2'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
  for r in select p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'cli_device_auth_%_v2'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

revoke all on function public.cli_device_auth_register_client_v2(uuid) from public, anon, authenticated;
grant execute on function public.cli_device_auth_register_client_v2(uuid) to service_role;

revoke all on function anttodo_private.cli_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function anttodo_private.cli_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema anttodo_private to supabase_auth_admin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'anttodo-purge-cli-device-auth') then
    perform cron.unschedule('anttodo-purge-cli-device-auth');
  end if;
  perform cron.schedule(
    'anttodo-purge-cli-auth-v2', '*/15 * * * *',
    'select anttodo_private.purge_cli_auth_v2()'
  );
end $$;
