create or replace function public.set_connector_secret(
  p_connector_id uuid,
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
    raise exception 'Invalid connector secret';
  end if;

  select workspace_id, credential_secret_id
    into v_workspace_id, v_secret_id
  from public.connector_instances
  where id = p_connector_id;

  if v_workspace_id is null
    or not anttodo_private.is_workspace_admin(v_workspace_id) then
    raise exception 'Connector administrator access required';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'anttodo_' || p_connector_id::text,
      'AntTodo connector credential'
    );
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;

  v_hint := '••••' || right(p_secret, 4);
  update public.connector_instances
  set credential_secret_id = v_secret_id,
      credential_hint = v_hint
  where id = p_connector_id;

  return v_hint;
end;
$$;

create or replace function public.delete_connector_secret(p_connector_id uuid)
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
  from public.connector_instances
  where id = p_connector_id;

  if v_workspace_id is null
    or not anttodo_private.is_workspace_admin(v_workspace_id) then
    raise exception 'Connector administrator access required';
  end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  update public.connector_instances
  set credential_secret_id = null,
      credential_hint = null
  where id = p_connector_id;

  return true;
end;
$$;

revoke all on function public.set_connector_secret(uuid, text) from public, anon;
revoke all on function public.delete_connector_secret(uuid) from public, anon;
grant execute on function public.set_connector_secret(uuid, text) to authenticated;
grant execute on function public.delete_connector_secret(uuid) to authenticated;
