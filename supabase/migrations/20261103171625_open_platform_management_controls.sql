begin;
-- Disambiguate SQL grant aliases from the management function row variable.
create or replace function public.open_platform_admin(p_action text,p_actor uuid,p_body jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
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
commit;
