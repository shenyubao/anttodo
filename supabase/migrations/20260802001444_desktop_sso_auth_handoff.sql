create table anttodo_private.sso_auth_handoffs (
  code_hash text primary key
    check (code_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token_hash text not null check (char_length(token_hash) > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index sso_auth_handoffs_expires_at_idx
  on anttodo_private.sso_auth_handoffs (expires_at);

alter table anttodo_private.sso_auth_handoffs enable row level security;

revoke all on table anttodo_private.sso_auth_handoffs
  from public, anon, authenticated;

create or replace function anttodo_private.create_sso_auth_handoff(
  p_code_hash text,
  p_workspace_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_code_hash !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_token_hash, '')) = 0
    or p_expires_at <= now()
    or p_expires_at > now() + interval '5 minutes' then
    raise exception 'Invalid SSO auth handoff';
  end if;

  delete from anttodo_private.sso_auth_handoffs
  where expires_at < now() - interval '1 day';

  insert into anttodo_private.sso_auth_handoffs (
    code_hash,
    workspace_id,
    token_hash,
    expires_at
  ) values (
    p_code_hash,
    p_workspace_id,
    p_token_hash,
    p_expires_at
  );
end;
$$;

create or replace function anttodo_private.consume_sso_auth_handoff(
  p_code_hash text
)
returns table (
  status text,
  workspace_id uuid,
  token_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff anttodo_private.sso_auth_handoffs%rowtype;
begin
  update anttodo_private.sso_auth_handoffs as handoff
  set consumed_at = now()
  where handoff.code_hash = p_code_hash
    and handoff.consumed_at is null
    and handoff.expires_at > now()
  returning handoff.* into v_handoff;

  if found then
    return query select 'ok'::text, v_handoff.workspace_id, v_handoff.token_hash;
    return;
  end if;

  select handoff.* into v_handoff
  from anttodo_private.sso_auth_handoffs as handoff
  where handoff.code_hash = p_code_hash;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text;
  elsif v_handoff.consumed_at is not null then
    return query select 'consumed'::text, null::uuid, null::text;
  else
    return query select 'expired'::text, null::uuid, null::text;
  end if;
end;
$$;

create or replace function public.create_sso_auth_handoff(
  p_code_hash text,
  p_workspace_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  select anttodo_private.create_sso_auth_handoff(
    p_code_hash,
    p_workspace_id,
    p_token_hash,
    p_expires_at
  );
$$;

create or replace function public.consume_sso_auth_handoff(
  p_code_hash text
)
returns table (
  status text,
  workspace_id uuid,
  token_hash text
)
language sql
security definer
set search_path = ''
as $$
  select * from anttodo_private.consume_sso_auth_handoff(p_code_hash);
$$;

revoke all on function anttodo_private.create_sso_auth_handoff(text, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function anttodo_private.consume_sso_auth_handoff(text)
  from public, anon, authenticated;
revoke all on function public.create_sso_auth_handoff(text, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_sso_auth_handoff(text)
  from public, anon, authenticated;

grant execute on function public.create_sso_auth_handoff(text, uuid, text, timestamptz)
  to service_role;
grant execute on function public.consume_sso_auth_handoff(text)
  to service_role;
