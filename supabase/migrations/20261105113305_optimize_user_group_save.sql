-- Keep the table APIs available to older clients; new clients save atomically.
create or replace function public.save_user_group(
  p_workspace_id uuid,
  p_id uuid,
  p_name text,
  p_member_ids uuid[],
  p_expected_name text default null,
  p_expected_member_ids uuid[] default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.user_groups%rowtype;
  requested_members uuid[];
  current_members uuid[];
  expected_members uuid[];
  is_new boolean;
  name_changed boolean;
  members_changed boolean;
begin
  if auth.uid() is null or not anttodo_private.is_workspace_admin(p_workspace_id) then
    raise exception '仅所有者和管理员可以管理用户组。' using errcode = '42501';
  end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception '用户组名称应为 1 到 80 个字符。' using errcode = '23514';
  end if;
  if p_member_ids is null or array_position(p_member_ids, null) is not null then
    raise exception '用户组成员不能为空值。' using errcode = '23514';
  end if;
  select coalesce(array_agg(distinct id order by id), '{}'::uuid[])
    into requested_members from unnest(p_member_ids) id;
  if exists (
    select 1 from unnest(requested_members) id
    where not exists (select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = id)
  ) then
    raise exception '只能选择当前团队空间的成员。' using errcode = '23503';
  end if;

  select * into saved from public.user_groups
    where id = p_id and workspace_id = p_workspace_id for update;
  is_new := not found;
  if is_new then
    if p_expected_name is not null then
      raise exception '用户组已被修改或删除。' using errcode = 'PT409';
    end if;
    insert into public.user_groups(id, workspace_id, name, created_by)
      values (p_id, p_workspace_id, btrim(p_name), auth.uid()) returning * into saved;
    current_members := '{}'::uuid[];
    name_changed := true;
  else
    select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
      into current_members from public.user_group_members where group_id = p_id;
    select coalesce(array_agg(distinct id order by id), '{}'::uuid[])
      into expected_members from unnest(p_expected_member_ids) id;
    if p_expected_name is null or p_expected_member_ids is null
      or saved.name is distinct from p_expected_name
      or current_members is distinct from expected_members then
      raise exception '用户组已被其他人修改。' using errcode = 'PT409';
    end if;
    name_changed := saved.name is distinct from btrim(p_name);
  end if;
  members_changed := current_members is distinct from requested_members;
  if not is_new and (name_changed or members_changed) then
    update public.user_groups set name = btrim(p_name)
      where id = p_id and workspace_id = p_workspace_id returning * into saved;
  end if;
  if members_changed then
    delete from public.user_group_members
      where group_id = p_id and not (user_id = any(requested_members));
    insert into public.user_group_members(group_id, workspace_id, user_id)
      select p_id, p_workspace_id, id from unnest(requested_members) id
      where not (id = any(current_members));
  end if;
  return jsonb_build_object(
    'group', to_jsonb(saved),
    'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.user_id), '[]'::jsonb)
      from public.user_group_members m where m.group_id = p_id),
    'name_changed', name_changed,
    'members_changed', members_changed
  );
end;
$$;
revoke all on function public.save_user_group(uuid, uuid, text, uuid[], text, uuid[]) from public, anon;
grant execute on function public.save_user_group(uuid, uuid, text, uuid[], text, uuid[]) to authenticated;
