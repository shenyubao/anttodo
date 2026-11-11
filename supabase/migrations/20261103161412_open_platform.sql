begin;

-- Third-party tokens never inherit authenticated. Only this non-login executor
-- inherits the existing user RLS policies; it owns the bounded dispatcher.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anttodo_openapi') then create role anttodo_openapi nologin noinherit nobypassrls; end if;
  if not exists(select 1 from pg_roles where rolname='anttodo_openapi_executor') then create role anttodo_openapi_executor nologin inherit nobypassrls; end if;
end $$;
grant anttodo_openapi to authenticator;
grant authenticated to anttodo_openapi_executor;
grant anttodo_openapi_executor to postgres;
grant usage on schema public to anttodo_openapi;

create table anttodo_private.open_apps (
  client_id uuid primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  client_type text not null check(client_type in ('public','confidential','personal')),
  redirect_uris jsonb not null default '[]',
  client_secret_hash text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table anttodo_private.open_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references anttodo_private.open_apps(client_id),
  oauth_client_id uuid not null,
  name text not null check(char_length(name) between 1 and 100),
  workspace_ids uuid[] not null check(cardinality(workspace_ids)>0),
  permissions text[] not null check(permissions <@ array['tasks:read','tasks:write','tasks:delete'] and 'tasks:read'=any(permissions)),
  authorization_id text,
  pending_until timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  credential_hash text check(credential_hash ~ '^[0-9a-f]{64}$'),
  access_hash text,
  access_expires timestamptz,
  refresh_hash text,
  bundle_secret_id uuid,
  access_expires_at timestamptz,
  refresh_lease uuid,
  refresh_lease_until timestamptz
);
create index open_grants_user_idx on anttodo_private.open_grants(user_id,created_at desc);
create index open_grants_pending_idx on anttodo_private.open_grants(user_id,client_id,pending_until);
create table anttodo_private.open_sessions (
  session_id uuid primary key,
  grant_id uuid not null references anttodo_private.open_grants(id) on delete cascade
);
create table anttodo_private.open_flows (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  state_hash text not null unique,
  verifier_secret_id uuid,
  grant_id uuid references anttodo_private.open_grants(id) on delete cascade,
  client_id uuid references anttodo_private.open_apps(client_id),
  redirect_uri text,
  app_origin text,
  client_state text,
  code_challenge text,
  code_hash text,
  code_expires_at timestamptz,
  exchanged_at timestamptz,
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed_at timestamptz
);
create table anttodo_private.open_requests (
  grant_id uuid not null references anttodo_private.open_grants(id) on delete cascade,
  key text not null,
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(grant_id,key)
);
create table anttodo_private.open_rates (
  grant_id uuid primary key references anttodo_private.open_grants(id) on delete cascade,
  window_at timestamptz not null default date_trunc('minute',now()),
  requests integer not null default 0
);
do $$ declare t text; begin
  foreach t in array array['open_apps','open_grants','open_sessions','open_flows','open_requests','open_rates'] loop
    execute format('alter table anttodo_private.%I enable row level security',t);
    execute format('revoke all on anttodo_private.%I from public,anon,authenticated',t);
    execute format('grant all on anttodo_private.%I to service_role',t);
  end loop;
end $$;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Preserve every existing
-- caller before removing that implicit privilege from the isolated API role.
do $$ declare f record; r text; begin
  for f in select p.oid,p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','anttodo_private') and p.prokind='f' and p.prorettype<>'pg_catalog.trigger'::regtype
      and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE')
  loop
    foreach r in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
      execute format('grant execute on function %s to %I',f.signature,r);
    end loop;
    execute format('revoke execute on function %s from public',f.signature);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema anttodo_private revoke execute on functions from public;

alter function anttodo_private.cli_access_token_hook(jsonb) rename to cli_access_token_hook_v2;
create function anttodo_private.cli_access_token_hook(event jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c jsonb; cid uuid; sid uuid; uid uuid; gid uuid;
begin
  c := anttodo_private.cli_access_token_hook_v2(event)->'claims';
  cid := nullif(c->>'client_id','')::uuid;
  if cid is null or exists(select 1 from anttodo_private.cli_oauth_clients where client_id=cid) then
    return jsonb_build_object('claims',c);
  end if;
  -- Unknown/deleted OAuth apps fail closed, rather than becoming first-party.
  c := jsonb_set(c,'{role}','"anttodo_openapi"');
  if not exists(select 1 from anttodo_private.open_apps where client_id=cid) then
    return jsonb_build_object('claims',c);
  end if;
  sid := nullif(c->>'session_id','')::uuid; uid := nullif(c->>'sub','')::uuid;
  select s.grant_id into gid from anttodo_private.open_sessions s where s.session_id=sid;
  if gid is null then
    select g.id into gid from anttodo_private.open_grants g
    join anttodo_private.open_apps a on a.client_id=g.client_id
    where g.user_id=uid and g.oauth_client_id=cid and g.revoked_at is null and a.revoked_at is null
      and g.pending_until>now() and (g.expires_at is null or g.expires_at>now())
    order by g.created_at desc limit 1 for update of g;
    if gid is not null then
      insert into anttodo_private.open_sessions values(sid,gid) on conflict do nothing;
      update anttodo_private.open_grants set pending_until=null where id=gid;
    end if;
  end if;
  if not exists(select 1 from anttodo_private.open_grants g join anttodo_private.open_apps a using(client_id)
    where g.id=gid and g.user_id=uid and g.oauth_client_id=cid and g.revoked_at is null and a.revoked_at is null
      and (g.expires_at is null or g.expires_at>now())) then
    raise exception 'Open API authorization expired or revoked' using errcode='42501';
  end if;
  c := jsonb_set(c,'{open_grant_id}',to_jsonb(gid::text));
  c := jsonb_set(c,'{exp}',to_jsonb(least((c->>'exp')::bigint,(c->>'iat')::bigint+900)));
  return jsonb_build_object('claims',c);
end $$;
revoke all on function anttodo_private.cli_access_token_hook(jsonb) from public,anon,authenticated;
grant execute on function anttodo_private.cli_access_token_hook(jsonb) to supabase_auth_admin;

create function anttodo_private.open_context()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare g anttodo_private.open_grants; sid uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or auth.jwt()->>'role'<>'anttodo_openapi' then
    raise exception 'invalid_token' using errcode='28000';
  end if;
  select x.* into g from anttodo_private.open_grants x
    join anttodo_private.open_sessions s on s.grant_id=x.id
    join anttodo_private.open_apps a on a.client_id=x.client_id
    where s.session_id=sid and x.id::text=auth.jwt()->>'open_grant_id'
      and x.oauth_client_id::text=auth.jwt()->>'client_id' and x.user_id=auth.uid()
      and x.revoked_at is null and a.revoked_at is null and (x.expires_at is null or x.expires_at>now())
      and exists(select 1 from auth.sessions ss where ss.id=sid and ss.user_id=x.user_id and (ss.not_after is null or ss.not_after>now()))
      and exists(select 1 from auth.users u where u.id=x.user_id and (u.banned_until is null or u.banned_until<now()));
  if g.id is null then raise exception 'invalid_token' using errcode='28000'; end if;
  insert into anttodo_private.open_rates(grant_id,requests) values(g.id,1)
    on conflict(grant_id) do update set
      requests=case when open_rates.window_at<date_trunc('minute',now()) then 1 else open_rates.requests+1 end,
      window_at=date_trunc('minute',now());
  if (select requests from anttodo_private.open_rates where grant_id=g.id)>120 then
    raise exception 'rate_limited' using errcode='P0429';
  end if;
  update anttodo_private.open_grants set last_used_at=now() where id=g.id;
  return jsonb_build_object('id',g.id,'user_id',g.user_id,'workspace_ids',g.workspace_ids,'permissions',g.permissions);
end $$;
revoke all on function anttodo_private.open_context() from public,anon,authenticated;
grant execute on function anttodo_private.open_context() to anttodo_openapi_executor;

create function anttodo_private.open_idempotency(p_grant uuid,p_key text,p_fingerprint text,p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing anttodo_private.open_requests;
begin
  if p_key is null then return null; end if;
  if char_length(p_key) not between 1 and 200 then raise exception 'invalid_idempotency_key' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_grant::text||':'||p_key,0));
  delete from anttodo_private.open_requests where grant_id=p_grant and key=p_key and created_at<now()-interval '24 hours';
  select * into existing from anttodo_private.open_requests where grant_id=p_grant and key=p_key;
  if existing.grant_id is not null and existing.fingerprint<>p_fingerprint then
    raise exception 'idempotency_key_reused' using errcode='P0409';
  end if;
  if p_response is not null then
    insert into anttodo_private.open_requests(grant_id,key,fingerprint,response) values(p_grant,p_key,p_fingerprint,p_response) on conflict do nothing;
  end if;
  return existing.response;
end $$;
revoke all on function anttodo_private.open_idempotency(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function anttodo_private.open_idempotency(uuid,text,text,jsonb) to anttodo_openapi_executor;

-- A service-only management boundary. The Edge Function verifies actor JWTs;
-- browsers and third-party roles cannot call this RPC or read Vault directly.
create function public.open_platform_admin(p_action text,p_actor uuid,p_body jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare g anttodo_private.open_grants; f anttodo_private.open_flows; result jsonb; ids uuid[]; perms text[]; expiry timestamptz; secret_id uuid;
begin
  if p_action='register_app' then
    insert into anttodo_private.open_apps(client_id,owner_id,name,client_type,redirect_uris,client_secret_hash)
      values((p_body->>'client_id')::uuid,p_actor,p_body->>'name',p_body->>'client_type',coalesce(p_body->'redirect_uris','[]'),p_body->>'client_secret_hash');
    return jsonb_build_object('ok',true);
  elsif p_action='list' then
    return jsonb_build_object('grants',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select g.id,g.name,g.client_id,a.client_type,g.workspace_ids,g.permissions,g.expires_at,g.created_at,g.last_used_at,g.revoked_at
      from anttodo_private.open_grants g join anttodo_private.open_apps a using(client_id) where g.user_id=p_actor order by g.created_at desc
    ) x),'[]'),'apps',coalesce((select jsonb_agg(to_jsonb(a)-'client_secret_hash') from anttodo_private.open_apps a where a.owner_id=p_actor and a.revoked_at is null),'[]'));
  elsif p_action='app' then
    return (select to_jsonb(a)-'client_secret_hash' from anttodo_private.open_apps a where client_id=(p_body->>'client_id')::uuid and revoked_at is null);
  elsif p_action='grant' then
    ids:=array(select jsonb_array_elements_text(p_body->'workspace_ids')::uuid);
    perms:=array(select jsonb_array_elements_text(p_body->'permissions'));
    if cardinality(ids)=0 or exists(select 1 from unnest(ids) wid where not exists(
      select 1 from public.workspace_members m where m.workspace_id=wid and m.user_id=p_actor)) then
      raise exception 'invalid_workspace' using errcode='42501';
    end if;
    expiry:=anttodo_private.cli_expiry(coalesce(p_body->>'lifetime','90'));
    if expiry='infinity'::timestamptz then raise exception 'invalid_lifetime' using errcode='22023'; end if;
    if not exists(select 1 from anttodo_private.open_apps where client_id=(p_body->>'client_id')::uuid and revoked_at is null) then
      raise exception 'unknown_app' using errcode='42501'; end if;
    -- One pending approval per user/app. Already-bound sessions retain their
    -- immutable grant; refreshing them cannot inherit a later wider approval.
    update anttodo_private.open_grants set pending_until=null where user_id=p_actor and oauth_client_id=(p_body->>'oauth_client_id')::uuid;
    insert into anttodo_private.open_grants(user_id,client_id,oauth_client_id,name,workspace_ids,permissions,authorization_id,pending_until,expires_at)
      values(p_actor,(p_body->>'client_id')::uuid,(p_body->>'oauth_client_id')::uuid,p_body->>'name',ids,perms,p_body->>'authorization_id',now()+interval '10 minutes',expiry)
      returning * into g;
    return jsonb_build_object('id',g.id);
  elsif p_action='revoke' then
    update anttodo_private.open_grants set revoked_at=now(),pending_until=null where id=(p_body->>'id')::uuid and user_id=p_actor returning * into g;
    if g.id is null then raise exception 'not_found' using errcode='P0404'; end if;
    delete from vault.secrets where id=g.bundle_secret_id;
    return jsonb_build_object('ok',true);
  elsif p_action='revoke_app' then
    update anttodo_private.open_apps set revoked_at=now() where client_id=(p_body->>'client_id')::uuid and owner_id=p_actor;
    if not found then raise exception 'not_found' using errcode='P0404'; end if;
    update anttodo_private.open_grants set revoked_at=now() where client_id=(p_body->>'client_id')::uuid;
    delete from vault.secrets where id in(select bundle_secret_id from anttodo_private.open_grants where client_id=(p_body->>'client_id')::uuid);
    return jsonb_build_object('ok',true);
  elsif p_action='flow' then
    select * into g from anttodo_private.open_grants where id=(p_body->>'grant_id')::uuid and user_id=p_actor and revoked_at is null;
    if g.id is null then raise exception 'not_found' using errcode='P0404'; end if;
    secret_id:=vault.create_secret(p_body->>'verifier');
    if p_body ? 'flow_id' then
      update anttodo_private.open_flows set user_id=p_actor,grant_id=g.id,app_origin=coalesce(app_origin,p_body->>'app_origin'),state_hash=p_body->>'state_hash',verifier_secret_id=secret_id
        where id=(p_body->>'flow_id')::uuid and grant_id is null and expires_at>now() returning * into f;
      if f.id is null then raise exception 'invalid_state' using errcode='28000'; end if;
    else
      insert into anttodo_private.open_flows(user_id,state_hash,verifier_secret_id,grant_id,app_origin)
        values(p_actor,p_body->>'state_hash',secret_id,g.id,p_body->>'app_origin') returning * into f;
    end if;
    return jsonb_build_object('id',f.id);
  elsif p_action='callback' then
    select * into f from anttodo_private.open_flows where state_hash=p_body->>'state_hash' and consumed_at is null and expires_at>now() for update;
    if f.id is null then raise exception 'invalid_state' using errcode='28000'; end if;
    update anttodo_private.open_flows set consumed_at=now() where id=f.id;
    return jsonb_build_object('id',f.id,'grant_id',f.grant_id,'user_id',f.user_id,'client_id',f.client_id,'redirect_uri',f.redirect_uri,'client_state',f.client_state,'app_origin',f.app_origin,'verifier',(select decrypted_secret from vault.decrypted_secrets where id=f.verifier_secret_id));
  elsif p_action='save_bundle' then
    select * into g from anttodo_private.open_grants where id=(p_body->>'id')::uuid and user_id=p_actor and revoked_at is null for update;
    if g.id is null then raise exception 'invalid_token' using errcode='28000'; end if;
    secret_id:=vault.create_secret((p_body->'bundle')::text);
    delete from vault.secrets where id=g.bundle_secret_id;
    update anttodo_private.open_grants set bundle_secret_id=secret_id,credential_hash=p_body->>'credential_hash',access_expires_at=(p_body->>'access_expires_at')::timestamptz,refresh_lease=null,refresh_lease_until=null where id=g.id;
    delete from vault.secrets where id in(select verifier_secret_id from anttodo_private.open_flows where grant_id=g.id);
    return jsonb_build_object('ok',true);
  elsif p_action='exchange' then
    select x.* into g from anttodo_private.open_grants x join anttodo_private.open_apps a using(client_id)
      where x.id=(p_body->>'id')::uuid and (
        p_body->>'kind'='personal' and x.credential_hash=p_body->>'credential_hash'
        or p_body->>'kind'='oauth' and x.access_hash=p_body->>'credential_hash' and x.access_expires>now()
      ) and x.revoked_at is null and a.revoked_at is null
        and (x.expires_at is null or x.expires_at>now()) for update of x;
    if g.id is null then raise exception 'invalid_token' using errcode='28000'; end if;
    if g.access_expires_at>now()+interval '60 seconds' then
      return jsonb_build_object('user_id',g.user_id,'client_id',g.client_id,'lease_acquired',false,'bundle',(select decrypted_secret::jsonb from vault.decrypted_secrets where id=g.bundle_secret_id));
    end if;
    if g.refresh_lease_until>now() then raise exception 'refresh_in_progress' using errcode='P0429'; end if;
    update anttodo_private.open_grants set refresh_lease=(p_body->>'lease')::uuid,refresh_lease_until=now()+interval '30 seconds' where id=g.id;
    return jsonb_build_object('user_id',g.user_id,'client_id',g.client_id,'lease_acquired',true,'bundle',(select decrypted_secret::jsonb from vault.decrypted_secrets where id=g.bundle_secret_id));
  elsif p_action='refresh' then
    select * into g from anttodo_private.open_grants where id=(p_body->>'id')::uuid and refresh_lease=(p_body->>'lease')::uuid and revoked_at is null for update;
    if g.id is null then raise exception 'invalid_token' using errcode='28000'; end if;
    if p_body ? 'bundle' then perform vault.update_secret(g.bundle_secret_id,(p_body->'bundle')::text); end if;
    update anttodo_private.open_grants set refresh_lease=null,refresh_lease_until=null,access_expires_at=coalesce((p_body->>'access_expires_at')::timestamptz,access_expires_at) where id=g.id;
    return jsonb_build_object('ok',true);
  elsif p_action='oauth_begin' then
    if not exists(select 1 from anttodo_private.open_apps a where a.client_id=(p_body->>'client_id')::uuid and a.revoked_at is null and a.client_type<>'personal' and a.redirect_uris ? (p_body->>'redirect_uri')) then raise exception 'invalid_client' using errcode='28000'; end if;
    insert into anttodo_private.open_flows(state_hash,verifier_secret_id,client_id,redirect_uri,client_state,code_challenge,app_origin)
      values(p_body->>'state_hash',null,(p_body->>'client_id')::uuid,p_body->>'redirect_uri',p_body->>'state',p_body->>'code_challenge',p_body->>'app_origin') returning * into f;
    return jsonb_build_object('id',f.id);
  elsif p_action='oauth_inspect' then
    select * into f from anttodo_private.open_flows where id=(p_body->>'id')::uuid and grant_id is null and expires_at>now();
    if f.id is null then raise exception 'invalid_state' using errcode='28000'; end if;
    return jsonb_build_object('id',f.id,'client_id',f.client_id,'name',(select name from anttodo_private.open_apps where client_id=f.client_id and revoked_at is null));
  elsif p_action='oauth_deny' then
    update anttodo_private.open_flows set expires_at=now() where id=(p_body->>'id')::uuid and grant_id is null and expires_at>now() returning * into f;
    if f.id is null then raise exception 'invalid_state' using errcode='28000'; end if;
    return jsonb_build_object('redirect_uri',f.redirect_uri,'state',f.client_state);
  elsif p_action='pending' then
    select * into g from anttodo_private.open_grants where user_id=p_actor and oauth_client_id=(p_body->>'client_id')::uuid and pending_until>now() and revoked_at is null order by created_at desc limit 1;
    if g.id is null then raise exception 'invalid_state' using errcode='28000'; end if;
    return jsonb_build_object('name',g.name,'workspace_ids',g.workspace_ids,'permissions',g.permissions,'personal',g.client_id=g.oauth_client_id);
  elsif p_action='oauth_code' then
    update anttodo_private.open_flows set code_hash=p_body->>'code_hash',code_expires_at=now()+interval '1 minute'
      where id=(p_body->>'id')::uuid and user_id=p_actor and consumed_at is not null and client_id is not null and code_hash is null;
    if not found then raise exception 'invalid_state' using errcode='28000'; end if;
    return jsonb_build_object('ok',true);
  elsif p_action='oauth_token' then
    if not exists(select 1 from anttodo_private.open_apps a where a.client_id=(p_body->>'client_id')::uuid and a.revoked_at is null and (
      a.client_type='public' or a.client_type='confidential' and a.client_secret_hash=p_body->>'client_secret_hash'
    )) then raise exception 'invalid_client' using errcode='28000'; end if;
    if p_body->>'grant_type'='authorization_code' then
      select * into f from anttodo_private.open_flows where client_id=(p_body->>'client_id')::uuid and code_hash=p_body->>'code_hash' and code_expires_at>now() and exchanged_at is null and redirect_uri=p_body->>'redirect_uri' and code_challenge=p_body->>'code_challenge' for update;
      if f.id is null then raise exception 'invalid_grant' using errcode='28000'; end if;
      select * into g from anttodo_private.open_grants where id=f.grant_id and revoked_at is null and (expires_at is null or expires_at>now()) for update;
      update anttodo_private.open_flows set exchanged_at=now() where id=f.id;
    elsif p_body->>'grant_type'='refresh_token' then
      select * into g from anttodo_private.open_grants where id=(p_body->>'id')::uuid and client_id=(p_body->>'client_id')::uuid and refresh_hash=p_body->>'refresh_hash' and revoked_at is null and (expires_at is null or expires_at>now()) for update;
    else raise exception 'unsupported_grant_type' using errcode='22023'; end if;
    if g.id is null then raise exception 'invalid_grant' using errcode='28000'; end if;
    update anttodo_private.open_grants set access_hash=p_body->>'access_hash',refresh_hash=p_body->>'new_refresh_hash',access_expires=least(now()+interval '15 minutes',coalesce(expires_at,now()+interval '15 minutes')) where id=g.id;
    return jsonb_build_object('id',g.id,'expires_in',least(900,coalesce(extract(epoch from g.expires_at-now())::integer,900)));
  end if;
  raise exception 'invalid_action' using errcode='22023';
end $$;
revoke all on function public.open_platform_admin(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.open_platform_admin(text,uuid,jsonb) to service_role;

grant execute on function anttodo_private.task_root_id(uuid) to anttodo_openapi_executor;

create function anttodo_private.open_task(p_id uuid,p_permissions jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'id',t.id,'workspace_id',t.workspace_id,'parent_task_id',t.parent_task_id,'title',t.title,
    'description',t.description,'status',t.status,'priority',t.priority,'due_at',t.due_at,
    'due_start_at',t.due_start_at,'due_is_all_day',t.due_is_all_day,'due_timezone',t.due_timezone,
    'recurrence',t.recurrence,'assignee_id',t.assignee_id,'position',t.position,'version',t.version,
    'created_at',t.created_at,'updated_at',t.updated_at,'deleted_at',t.deleted_at,
    'label_ids',coalesce((select jsonb_agg(label_id) from public.task_labels where task_id=anttodo_private.task_root_id(t.id)),'[]'),
    'url_path','/workspaces/'||t.workspace_id||'/tasks/'||t.id,
    'capabilities',jsonb_build_object(
      'edit',p_permissions ? 'tasks:write' and t.deleted_at is null and anttodo_private.can_edit_task(t.id),
      'complete',p_permissions ? 'tasks:write' and t.deleted_at is null and anttodo_private.can_edit_task(t.id),
      'delete',p_permissions ? 'tasks:delete' and t.deleted_at is null and anttodo_private.can_organize_task(t.id),
      'restore',p_permissions ? 'tasks:delete' and t.deleted_at is not null and anttodo_private.can_organize_task(t.id),
      'move',p_permissions ? 'tasks:write' and t.deleted_at is null and anttodo_private.can_edit_task(t.id),
      'reorder',p_permissions ? 'tasks:write' and t.deleted_at is null and anttodo_private.can_organize_task(t.id),
      'duplicate',p_permissions ? 'tasks:write' and t.deleted_at is null and anttodo_private.can_edit_task(t.id),
      'subtask',p_permissions ? 'tasks:write' and t.deleted_at is null and anttodo_private.can_edit_task(t.id)
    )
  ) from public.tasks t where t.id=p_id and t.kind='todo'
$$;
revoke all on function anttodo_private.open_task(uuid,jsonb) from public,anon,authenticated;
grant execute on function anttodo_private.open_task(uuid,jsonb) to anttodo_openapi_executor;

create function anttodo_private.open_due_matches(p_task public.tasks,p_filter text,p_zone text)
returns boolean language sql stable set search_path='' as $$
  select case p_filter
    when 'all' then true
    when 'overdue' then p_task.due_at<now()
    when 'today' then (p_task.due_at at time zone p_zone)::date=(now() at time zone p_zone)::date
    when 'tomorrow' then (p_task.due_at at time zone p_zone)::date=(now() at time zone p_zone)::date+1
    when 'this_week' then (p_task.due_at at time zone p_zone)::date between date_trunc('week',now() at time zone p_zone)::date and date_trunc('week',now() at time zone p_zone)::date+6
    when 'next_7_days' then (p_task.due_at at time zone p_zone)::date between (now() at time zone p_zone)::date and (now() at time zone p_zone)::date+6
    when 'next_30_days' then (p_task.due_at at time zone p_zone)::date between (now() at time zone p_zone)::date and (now() at time zone p_zone)::date+29
    else false end
$$;
revoke all on function anttodo_private.open_due_matches(public.tasks,text,text) from public,anon;
grant execute on function anttodo_private.open_due_matches(public.tasks,text,text) to anttodo_openapi_executor;

create function public.open_api_dispatch(p_method text,p_path text,p_query jsonb default '{}',p_body jsonb default '{}',p_version bigint default null,p_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
  ctx jsonb; perms jsonb; wid uuid; tid uuid; root_id uuid; label_id uuid; parent_id uuid; new_id uuid;
  seg text[]; action text; lk text; target text; source text; pref jsonb; def jsonb; zone text;
  row public.tasks; parent public.tasks; item record; data jsonb; result jsonb; cached jsonb;
  clone_map jsonb; original_id uuid; copied_root uuid;
  labels uuid[]; ids uuid[]; limit_n integer; offset_n integer; fingerprint text;
  can_write boolean; can_delete boolean; manual boolean; descending boolean; sort_key text;
begin
  ctx:=anttodo_private.open_context(); perms:=ctx->'permissions';
  if not perms ? 'tasks:read' then raise exception 'insufficient_scope' using errcode='42501'; end if;
  can_write:=perms ? 'tasks:write'; can_delete:=perms ? 'tasks:delete';
  seg:=string_to_array(trim(both '/' from p_path),'/');
  fingerprint:=encode(extensions.digest(jsonb_build_array(p_method,p_path,p_query,p_body,p_version)::text,'sha256'),'hex');
  if p_method<>'GET' then
    if p_method='DELETE' or seg[3]='restore' then
      if not can_delete then raise exception 'insufficient_scope' using errcode='42501'; end if;
    elsif not can_write then raise exception 'insufficient_scope' using errcode='42501'; end if;
    cached:=anttodo_private.open_idempotency((ctx->>'id')::uuid,p_key,fingerprint);
    if cached is not null then
      data:=coalesce(cached#>'{data,task}',cached->'data');
      if not ctx->'workspace_ids' ? (data->>'workspace_id') or not anttodo_private.is_workspace_member((data->>'workspace_id')::uuid)
        or not exists(select 1 from public.tasks where id=(data->>'id')::uuid) then
        raise exception 'not_found' using errcode='P0404';
      end if;
      if exists(select 1 from jsonb_array_elements(coalesce(cached#>'{data,affected_tasks}','[]')) t
        where not exists(select 1 from public.tasks where id=(t->>'id')::uuid)) then
        raise exception 'not_found' using errcode='P0404';
      end if;
      return cached;
    end if;
  end if;
  if seg=array['me'] and p_method='GET' then
    data:=ctx-'id'||jsonb_build_object('id',auth.uid());
  elsif seg=array['workspaces'] and p_method='GET' then
    select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug)),'[]') into data
      from public.workspaces w where ctx->'workspace_ids' ? w.id::text;
  elsif seg[1]='workspaces' and cardinality(seg)=3 and seg[3] in ('labels','lists','tasks') then
    wid:=seg[2]::uuid;
    if not ctx->'workspace_ids' ? wid::text or not anttodo_private.is_workspace_member(wid) then
      raise exception 'workspace_not_authorized' using errcode='42501'; end if;
    if seg[3]='labels' and p_method='GET' then
      select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'workspace_id',l.workspace_id,'name',l.name,'color',l.color,'parent_id',l.parent_id,'kind',l.kind,'position',l.position) order by l.position,l.id),'[]') into data from public.labels l where l.workspace_id=wid;
    elsif seg[3]='lists' and p_method='GET' then
      select coalesce(jsonb_agg(x.obj order by x.pos,x.key),'[]') into data from (
        select v.key,coalesce(sp.position,v.ordinal)::integer pos,jsonb_build_object('id',v.key,'name',v.name,'type','system','workspace_id',wid,'parent_id',null,
          'url_path','/workspaces/'||wid||'/views/'||v.key,'capabilities',jsonb_build_object('create',can_write and v.key='inbox','move',can_write and v.key='inbox','reorder',false)) obj
        from (values('all','全部',0),('inbox','收集箱',1),('today','今天',2),('week','本周',3),('assigned','指派给我',4),('watching','我关注的',5),('trash','回收站',6)) v(key,name,ordinal)
        left join public.task_system_view_preferences sp on sp.workspace_id=wid and sp.user_id=auth.uid() and sp.view_key=v.key
        where coalesce(sp.visible,true)
        union all
        select 'label:'||l.id,l.position+100,jsonb_build_object('id','label:'||l.id,'name',l.name,'type','label','workspace_id',wid,'color',l.color,
          'parent_id',case when l.parent_id is null then null else 'label:'||l.parent_id end,'url_path','/workspaces/'||wid||'/tags/'||l.id,
          'capabilities',jsonb_build_object('create',can_write and anttodo_private.label_permission_level(l.id)>=2,'move',can_write and anttodo_private.label_permission_level(l.id)>=2,
            'reorder',can_write and anttodo_private.label_permission_level(l.id)>=2 and coalesce((select p.sort='custom' from public.task_list_preferences p where p.workspace_id=wid and p.user_id=auth.uid() and p.list_key='label:'||l.id and p.view_mode='list'),true)))
        from public.labels l where l.workspace_id=wid
        union all
        select 'custom:'||v.id,v.position+50,jsonb_build_object('id','custom:'||v.id,'name',v.name,'type','custom','workspace_id',wid,'parent_id',null,
          'url_path','/workspaces/'||wid||'/views/custom/'||v.id,'capabilities',jsonb_build_object('create',false,'move',false,'reorder',false))
        from public.custom_task_views v where v.workspace_id=wid and v.user_id=auth.uid() and v.visible
      ) x;
    elsif seg[3]='tasks' and p_method='GET' then
      lk:=coalesce(p_query->>'list_id','all'); zone:=coalesce(p_query->>'timezone','UTC');
      perform now() at time zone zone;
      if lk like 'label:%' then
        label_id:=substring(lk from 7)::uuid;
        if not exists(select 1 from public.labels where id=label_id and workspace_id=wid) then raise exception 'list_not_found' using errcode='P0404'; end if;
      elsif lk like 'custom:%' then
        select definition into def from public.custom_task_views where id=substring(lk from 8)::uuid and workspace_id=wid and user_id=auth.uid();
        if def is null then raise exception 'list_not_found' using errcode='P0404'; end if;
      elsif lk not in ('all','inbox','today','week','assigned','watching','trash') then raise exception 'invalid_list' using errcode='22023'; end if;
      limit_n:=coalesce((p_query->>'limit')::integer,100);
      offset_n:=coalesce(nullif(p_query->>'cursor','')::integer,0);
      if limit_n not between 1 and 200 or offset_n<0 then raise exception 'invalid_pagination' using errcode='22023'; end if;
      select to_jsonb(p) into pref from public.task_list_preferences p where p.workspace_id=wid and p.user_id=auth.uid() and p.list_key=lk and p.view_mode='list';
      sort_key:=coalesce(pref->>'sort','custom'); descending:=coalesce(pref->>'direction','asc')='desc';
      with recursive label_scope as (
        select id from public.labels where id=label_id and workspace_id=wid
        union all select l.id from public.labels l join label_scope s on l.parent_id=s.id where l.workspace_id=wid
      ), eligible as (
        select t.*,coalesce(pl.position,t.position) as list_position,coalesce(pl.section_id::text,'') section_key
        from public.tasks t
        left join public.task_list_placements pl on pl.task_id=anttodo_private.task_root_id(t.id) and pl.workspace_id=wid and pl.list_key=lk
        where t.workspace_id=wid and t.kind='todo'
          and ((lk='trash' or coalesce(def->>'scope','')='trash')=(t.deleted_at is not null))
          and (coalesce(p_query->>'status',case when lk='trash' then 'all' else 'open' end)='all' or t.status::text=coalesce(p_query->>'status','open'))
          and (not p_query ? 'assignee_id' or t.assignee_id::text=case when p_query->>'assignee_id'='me' then auth.uid()::text else p_query->>'assignee_id' end)
          and (not p_query ? 'q' or t.title ilike '%'||(p_query->>'q')||'%')
          and (lk<>'inbox' and coalesce(def->>'scope','')<>'inbox' or not exists(select 1 from public.task_labels where task_id=anttodo_private.task_root_id(t.id)))
          and (label_id is null or exists(select 1 from public.task_labels tl join label_scope s on s.id=tl.label_id where tl.task_id=anttodo_private.task_root_id(t.id)))
          and (coalesce(def->>'scope','')<>'label' or exists(select 1 from public.task_labels tl where tl.task_id=anttodo_private.task_root_id(t.id) and def->'label_ids' ? tl.label_id::text))
          and (lk<>'assigned' or t.assignee_id=auth.uid())
          and (lk<>'watching' or exists(select 1 from public.task_participants where task_id=t.id and user_id=auth.uid()))
          and (lk<>'today' or anttodo_private.open_due_matches(t,'today',zone))
          and (lk<>'week' or anttodo_private.open_due_matches(t,'this_week',zone))
          and (coalesce(def->>'filter_assignee','all')='all'
            or def->>'filter_assignee'='unassigned' and t.assignee_id is null
            or def->>'filter_assignee'='assigned_to_me' and t.assignee_id=auth.uid()
            or def->>'filter_assignee'='users' and def->'filter_assignee_ids' ? t.assignee_id::text)
          and (coalesce(def->>'filter_creator','all')='all' or t.created_by=auth.uid())
          and (coalesce(def->>'filter_watching','all')='all' or exists(select 1 from public.task_participants where task_id=t.id and user_id=auth.uid()))
          and (def is null or def->'filter_due' is null or exists(select 1 from jsonb_array_elements_text(def->'filter_due') d where anttodo_private.open_due_matches(t,d,zone)))
      ), page as (
        select * from eligible order by section_key,
          case when sort_key='title' and not descending then title end asc,case when sort_key='title' and descending then title end desc,
          case when sort_key='due' and not descending then due_at end asc nulls last,case when sort_key='due' and descending then due_at end desc nulls last,
          case when sort_key='created' and not descending then created_at end asc,case when sort_key='created' and descending then created_at end desc,
          case when sort_key='updated' and not descending then updated_at end asc,case when sort_key='updated' and descending then updated_at end desc,
          list_position,id limit limit_n+1 offset offset_n
      ), numbered as (select *,row_number() over() n from page)
      select jsonb_build_object('items',coalesce(jsonb_agg(anttodo_private.open_task(id,perms) order by n) filter(where n<=limit_n),'[]'),
        'next_cursor',case when count(*)>limit_n then (offset_n+limit_n)::text else null end) into data from numbered;
    elsif seg[3]='tasks' and p_method='POST' then
      if not can_write then raise exception 'insufficient_scope' using errcode='42501'; end if;
      lk:=coalesce(p_body->>'list_id','inbox'); parent_id:=nullif(p_body->>'parent_task_id','')::uuid;
      if parent_id is null and lk<>'inbox' and lk not like 'label:%' then raise exception 'creation_target_required' using errcode='22023'; end if;
      if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('title','description','priority','due_at','due_start_at','due_is_all_day','due_timezone','list_id','parent_task_id')) then raise exception 'unknown_field' using errcode='22023'; end if;
      if char_length(btrim(coalesce(p_body->>'title',''))) not between 1 and 500 then raise exception 'invalid_title' using errcode='22023'; end if;
      if parent_id is not null then
        select * into parent from public.tasks where id=parent_id and workspace_id=wid and kind='todo' and deleted_at is null;
        if parent.id is null or not anttodo_private.can_edit_task(parent_id) then raise exception 'parent_not_editable' using errcode='42501'; end if;
        new_id:=extensions.gen_random_uuid();
        insert into public.tasks(id,workspace_id,parent_task_id,title,description,priority,created_by)
          values(new_id,wid,parent_id,btrim(p_body->>'title'),coalesce(p_body->>'description',''),coalesce(p_body->>'priority','none')::public.task_priority,auth.uid());
      else
        labels:=case when lk='inbox' then array[]::uuid[] else array[substring(lk from 7)::uuid] end;
        row:=public.create_task_with_labels(wid,btrim(p_body->>'title'),labels,coalesce(p_body->>'description',''),null,coalesce(p_body->>'priority','none')::public.task_priority,null,null,'todo');
        new_id:=row.id;
      end if;
      if p_body ? 'due_at' then
        update public.tasks set due_at=(p_body->>'due_at')::timestamptz,due_start_at=(p_body->>'due_start_at')::timestamptz,
          due_is_all_day=coalesce((p_body->>'due_is_all_day')::boolean,false),due_timezone=p_body->>'due_timezone' where id=new_id;
      end if;
      data:=anttodo_private.open_task(new_id,perms);
    else raise exception 'not_found' using errcode='P0404'; end if;
  elsif seg[1]='tasks' and cardinality(seg) between 2 and 3 then
    tid:=seg[2]::uuid; action:=coalesce(seg[3],'');
    select * into row from public.tasks where id=tid and kind='todo';
    if row.id is null or not ctx->'workspace_ids' ? row.workspace_id::text then raise exception 'not_found' using errcode='P0404'; end if;
    wid:=row.workspace_id;
    if not anttodo_private.is_workspace_member(wid) then raise exception 'not_found' using errcode='P0404'; end if;
    if p_method='GET' and action='' then data:=anttodo_private.open_task(tid,perms);
    else
      if p_version is null then raise exception 'if_match_required' using errcode='P0428'; end if;
      -- Serialize tree/list writes before row locks, matching move_task's order.
      perform pg_advisory_xact_lock(hashtextextended('task-tree:'||wid::text,0));
      select * into row from public.tasks where id=tid for update;
      if row.version<>p_version then raise exception 'version_conflict' using errcode='P0412'; end if;
      if row.deleted_at is not null and action<>'restore' then raise exception 'task_deleted' using errcode='P0409'; end if;
      if p_method='DELETE' and action='' or p_method='POST' and action='restore' then
        if not can_delete or not anttodo_private.can_organize_task(tid) then raise exception 'insufficient_scope' using errcode='42501'; end if;
        if row.connector_id is not null then
          perform public.set_external_task_deleted_at(tid,case when action='restore' then null else now() end);
        else
          update public.tasks set deleted_at=case when action='restore' then null else now() end where id=tid;
        end if;
      elsif p_method='PATCH' and action='' then
        if not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('title','description','priority','due_at','due_start_at','due_is_all_day','due_timezone')) then raise exception 'unknown_field' using errcode='22023'; end if;
        if p_body ? 'title' and char_length(btrim(coalesce(p_body->>'title',''))) not between 1 and 500 then raise exception 'invalid_title' using errcode='22023'; end if;
        update public.tasks set title=case when p_body ? 'title' then btrim(p_body->>'title') else title end,
          description=case when p_body ? 'description' then p_body->>'description' else description end,
          priority=case when p_body ? 'priority' then (p_body->>'priority')::public.task_priority else priority end,
          due_at=case when p_body ? 'due_at' then (p_body->>'due_at')::timestamptz else due_at end,
          due_start_at=case when p_body ? 'due_start_at' then (p_body->>'due_start_at')::timestamptz else due_start_at end,
          due_is_all_day=case when p_body ? 'due_is_all_day' then (p_body->>'due_is_all_day')::boolean else due_is_all_day end,
          due_timezone=case when p_body ? 'due_timezone' then p_body->>'due_timezone' else due_timezone end where id=tid;
      elsif p_method='POST' and action in ('complete','reopen') then
        if not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        update public.tasks set status=case when action='complete' then 'completed'::public.task_status else 'open'::public.task_status end where id=tid;
      elsif p_method='POST' and action='duplicate' then
        if row.connector_id is not null or not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        root_id:=anttodo_private.task_root_id(tid);
        select coalesce(array_agg(label_id),array[]::uuid[]) into labels from public.task_labels where task_id=root_id;
        original_id:=tid; clone_map:='{}';
        for item in with recursive subtree as (
          select t.*,0 depth from public.tasks t where id=original_id
          union all select t.*,s.depth+1 from public.tasks t join subtree s on t.parent_task_id=s.id where t.deleted_at is null
        ) select * from subtree order by depth,position,id loop
          if item.connector_id is not null then raise exception 'connector_subtree_read_only' using errcode='42501'; end if;
          if item.depth=0 and item.parent_task_id is null then
            row:=public.create_task_with_labels(wid,coalesce(nullif(p_body->>'title',''),item.title),labels,item.description,item.due_at,item.priority,null,item.due_timezone,'todo');
            new_id:=row.id;
          else
            new_id:=extensions.gen_random_uuid();
            insert into public.tasks(id,workspace_id,parent_task_id,title,description,priority,position,created_by)
              values(new_id,wid,case when item.depth=0 then item.parent_task_id else (clone_map->>item.parent_task_id::text)::uuid end,
                case when item.depth=0 then coalesce(nullif(p_body->>'title',''),item.title) else item.title end,item.description,item.priority,item.position,auth.uid());
          end if;
          clone_map:=clone_map||jsonb_build_object(item.id::text,new_id);
          if item.depth=0 then copied_root:=new_id; end if;
          update public.tasks set due_at=item.due_at,due_start_at=item.due_start_at,due_is_all_day=item.due_is_all_day,
            due_timezone=item.due_timezone,recurrence=item.recurrence,estimate_hours=item.estimate_hours,estimate_pomodoros=item.estimate_pomodoros where id=new_id;
        end loop;
        tid:=copied_root;
      elsif p_method='POST' and action='move' then
        if not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        if p_body ? 'parent_task_id' then
          perform public.move_task(tid,(p_body->>'parent_task_id')::uuid,coalesce((p_body->>'position')::integer,0));
        else
          if row.parent_task_id is not null then raise exception 'move_root_required' using errcode='22023'; end if;
          target:=p_body->>'target_list_id'; source:=p_body->>'source_list_id';
          if target='inbox' then delete from public.task_labels where task_id=tid;
          elsif target like 'label:%' then
            label_id:=substring(target from 7)::uuid;
            if not exists(select 1 from public.labels where id=label_id and workspace_id=wid) or anttodo_private.label_permission_level(label_id)<2 then raise exception 'label_not_editable' using errcode='42501'; end if;
            if source like 'label:%' and source<>target then
              delete from public.task_labels where task_id=tid and task_labels.label_id=substring(source from 7)::uuid;
            end if;
            insert into public.task_labels(task_id,label_id) values(tid,label_id) on conflict do nothing;
          else raise exception 'invalid_move_target' using errcode='22023'; end if;
          update public.workspaces set updated_at=now() where id=wid;
        end if;
      elsif p_method='POST' and action='reorder' then
        if not anttodo_private.can_organize_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        lk:=p_body->>'list_id';
        select coalesce(p.sort='custom',true) into manual from public.task_list_preferences p where p.workspace_id=wid and p.user_id=auth.uid() and p.list_key=lk and p.view_mode='list';
        if lk not like 'label:%' or not coalesce(manual,true) then raise exception 'list_not_reorderable' using errcode='22023'; end if;
        if row.parent_task_id is not null then perform public.move_task(tid,row.parent_task_id,coalesce((p_body->>'position')::integer,0));
        else
          ids:=array(select jsonb_array_elements_text(p_body->'task_ids')::uuid);
          if cardinality(ids)=0 or not tid=any(ids) or cardinality(ids)<>cardinality(array(select distinct unnest(ids))) then raise exception 'invalid_order' using errcode='22023'; end if;
          if exists(select 1 from unnest(ids) i where not exists(select 1 from public.tasks t join public.task_labels tl on tl.task_id=t.id where t.id=i and t.workspace_id=wid and tl.label_id=substring(lk from 7)::uuid and t.parent_task_id is null)) then raise exception 'invalid_order' using errcode='42501'; end if;
          perform public.set_task_list_order(wid,lk,null,ids);
          update public.tasks set updated_at=now() where id=tid;
        end if;
      else raise exception 'not_found' using errcode='P0404'; end if;
      if p_method='PATCH' and p_body ?| array['due_at','due_start_at','due_is_all_day','due_timezone'] then
        select * into row from public.tasks where id=tid;
        perform public.save_task_schedule(tid,row.due_at,row.due_start_at,row.due_is_all_day,row.due_timezone,
          case when row.due_at is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('anchor',r.anchor,'offset_value',r.offset_value,'offset_unit',r.offset_unit,'local_time',r.local_time) order by r.position) from public.task_reminders r where r.task_id=tid),'[]') end,
          coalesce((select persistent from public.task_reminder_settings where task_id=tid),false),
          case when row.due_at is null then null else row.recurrence end);
      end if;
      data:=jsonb_build_object('task',anttodo_private.open_task(tid,perms),'affected_tasks',coalesce((
        select jsonb_agg(anttodo_private.open_task(t.id,perms)) from public.tasks t where t.workspace_id=wid and t.updated_at>=transaction_timestamp() and t.kind='todo'
      ),'[]'));
    end if;
  else raise exception 'not_found' using errcode='P0404'; end if;
  result:=jsonb_build_object('status',case when p_method='POST' and seg[1]='workspaces' then 201 else 200 end,'data',data);
  if p_method<>'GET' then perform anttodo_private.open_idempotency((ctx->>'id')::uuid,p_key,fingerprint,result); end if;
  return result;
end $$;
revoke all on function public.open_api_dispatch(text,text,jsonb,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.open_api_dispatch(text,text,jsonb,jsonb,bigint,text) to anttodo_openapi;
grant create on schema public to anttodo_openapi_executor;
alter function public.open_api_dispatch(text,text,jsonb,jsonb,bigint,text) owner to anttodo_openapi_executor;
revoke create on schema public from anttodo_openapi_executor;

create function anttodo_private.cleanup_open_api_user()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from vault.secrets where id in(
    select bundle_secret_id from anttodo_private.open_grants where user_id=old.id
    union all select verifier_secret_id from anttodo_private.open_flows where user_id=old.id
  );
  return old;
end $$;
revoke all on function anttodo_private.cleanup_open_api_user() from public,anon,authenticated;
create trigger cleanup_open_api_before_user_delete before delete on auth.users for each row execute function anttodo_private.cleanup_open_api_user();

select cron.schedule('anttodo-open-api-cleanup','17 * * * *', $job$
  delete from anttodo_private.open_requests where created_at<now()-interval '24 hours';
  delete from vault.secrets where id in(select verifier_secret_id from anttodo_private.open_flows where expires_at<now());
  delete from anttodo_private.open_flows where expires_at<now();
  delete from vault.secrets where id in(select bundle_secret_id from anttodo_private.open_grants where revoked_at is not null or expires_at<now());
  update anttodo_private.open_grants set bundle_secret_id=null where revoked_at is not null or expires_at<now();
$job$);
notify pgrst,'reload schema';
commit;
