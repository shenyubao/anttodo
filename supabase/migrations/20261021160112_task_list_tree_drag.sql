-- Keep tree moves inside their workspace, and serialize sibling order changes.
create or replace function public.move_task(
  p_task_id uuid,
  p_parent_task_id uuid default null,
  p_position integer default 0
) returns public.tasks language plpgsql security definer set search_path = '' as $$
declare moving public.tasks; destination public.tasks; old_root uuid; new_root uuid;
  conflict_users uuid[]; result public.tasks; promote_to_root boolean;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into moving from public.tasks where id=p_task_id;
  if not found then raise exception 'Task does not exist'; end if;
  if not anttodo_private.is_workspace_member(moving.workspace_id) or not anttodo_private.can_organize_task(moving.id) then raise exception 'Task is not editable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('task-tree:' || moving.workspace_id::text, 0));
  select * into moving from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task does not exist'; end if;
  if moving.deleted_at is not null then raise exception 'Deleted tasks cannot be moved'; end if;
  if not anttodo_private.can_organize_task(moving.id) then raise exception 'Task is not editable'; end if;
  if exists (
    with recursive tree as (
      select id,connector_id from public.tasks where id=moving.id
      union all select t.id,t.connector_id from public.tasks t join tree x on t.parent_task_id=x.id
    ) select 1 from tree where connector_id is not null
  ) then raise exception 'Connector tasks cannot be reparented'; end if;
  old_root := anttodo_private.task_root_id(moving.id);
  if p_parent_task_id is not null then
    select * into destination from public.tasks where id=p_parent_task_id for update;
    if not found then raise exception 'Parent task does not exist'; end if;
    if destination.deleted_at is not null or destination.connector_id is not null then
      raise exception 'Destination is not editable';
    end if;
    if destination.workspace_id <> moving.workspace_id then raise exception 'Parent task must be in the same workspace'; end if;
    if not anttodo_private.can_organize_task(destination.id) then raise exception 'Destination is not editable'; end if;
    new_root := anttodo_private.task_root_id(destination.id);
    with recursive tree as (
      select id,assignee_id from public.tasks where id=moving.id
      union all select t.id,t.assignee_id from public.tasks t join tree x on t.parent_task_id=x.id
    ), people as (
      select assignee_id user_id from tree where assignee_id is not null
      union select tp.user_id from public.task_participants tp join tree on tree.id=tp.task_id
    )
    select array_agg(user_id) into conflict_users from people
    where not anttodo_private.can_user_view_task(new_root,user_id);
    if cardinality(conflict_users)>0 then
      raise exception using message='Move would remove task visibility', detail=array_to_string(conflict_users,',');
    end if;
  else new_root := moving.id;
  end if;

  promote_to_root := p_parent_task_id is null and moving.parent_task_id is not null;
  if p_parent_task_id is not null and moving.parent_task_id is null then
    delete from public.task_labels where task_id=moving.id;
    delete from public.task_list_placements where task_id=moving.id;
  end if;
  update public.tasks
  set position=position-1
  where workspace_id=moving.workspace_id and parent_task_id is not distinct from moving.parent_task_id
    and id<>moving.id and position>moving.position;
  update public.tasks
  set position=position+1
  where workspace_id=moving.workspace_id and parent_task_id is not distinct from p_parent_task_id
    and id<>moving.id and position>=greatest(p_position,0);
  update public.tasks set parent_task_id=p_parent_task_id, position=greatest(p_position,0) where id=moving.id returning * into result;
  if promote_to_root then
    insert into public.task_labels(task_id,label_id)
    select moving.id,label_id from public.task_labels where task_id=old_root on conflict do nothing;
  end if;
  if moving.parent_task_id is distinct from p_parent_task_id then
    -- A client losing SELECT access cannot receive the moved row's Realtime
    -- update. The workspace remains visible to members and invalidates their
    -- cached trees, including newly visible and no-longer-visible descendants.
    update public.workspaces set updated_at=now() where id=moving.workspace_id;
  end if;
  return result;
end $$;
revoke all on function public.move_task(uuid,uuid,integer) from public, anon;
grant execute on function public.move_task(uuid,uuid,integer) to authenticated;


-- SECURITY INVOKER retains RLS and list permissions. A placement failure rolls
-- back the preceding move, including inherited-label and placement cleanup.
create or replace function public.move_task_in_list(
  p_task_id uuid,
  p_parent_task_id uuid,
  p_position integer,
  p_placement jsonb default null,
  p_expected_version bigint default null
) returns public.tasks
language plpgsql security invoker set search_path = '' as $$
declare
  moving public.tasks;
  result public.tasks;
  target_list_key text;
  target_section_id uuid;
  task_ids uuid[];
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into moving from public.tasks where id=p_task_id;
  if not found then raise exception 'Task is not editable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('task-tree:' || moving.workspace_id::text, 0));
  select * into moving from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task is not editable' using errcode='42501'; end if;
  if p_expected_version is not null and moving.version <> p_expected_version then
    raise exception 'Task changed; refresh and retry' using errcode='40001';
  end if;
  if p_placement is not null then
    if p_parent_task_id is not null or jsonb_typeof(p_placement) <> 'object'
      or jsonb_typeof(p_placement->'taskIds') is distinct from 'array'
      or coalesce(p_placement->>'listKey','') = '' then
      raise exception 'Invalid list placement' using errcode='22023';
    end if;
    target_list_key := p_placement->>'listKey';
    target_section_id := nullif(p_placement->>'sectionId','')::uuid;
    if not anttodo_private.can_edit_task_list(moving.workspace_id,target_list_key) then
      raise exception 'Insufficient list permission' using errcode='42501';
    end if;
    select array_agg(value::uuid) into task_ids from jsonb_array_elements_text(p_placement->'taskIds');
    if not p_task_id=any(coalesce(task_ids,array[]::uuid[])) then
      raise exception 'Placement must include the moved task' using errcode='22023';
    end if;
  end if;
  result := public.move_task(p_task_id,p_parent_task_id,p_position);
  if p_placement is not null then
    if not anttodo_private.can_organize_task(p_task_id) then
      raise exception 'Task is not editable' using errcode='42501';
    end if;
    perform public.set_task_list_order(moving.workspace_id,target_list_key,target_section_id,task_ids);
    if not exists(select 1 from public.task_list_placements
      where task_id=p_task_id and workspace_id=moving.workspace_id and task_list_placements.list_key=target_list_key
        and task_list_placements.section_id is not distinct from target_section_id) then
      raise exception 'List placement was not saved';
    end if;
  end if;
  return result;
end $$;
revoke all on function public.move_task_in_list(uuid,uuid,integer,jsonb,bigint) from public, anon;
grant execute on function public.move_task_in_list(uuid,uuid,integer,jsonb,bigint) to authenticated;

notify pgrst, 'reload schema';
