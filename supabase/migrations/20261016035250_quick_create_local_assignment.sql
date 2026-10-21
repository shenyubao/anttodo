begin;

-- Assignment is local metadata. Keep the general external-task UPDATE policy closed.
create or replace function anttodo_private.can_assign_quick_create_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.tasks task
      join public.connector_instances connector on connector.id = task.connector_id
      join public.workspace_members member on member.workspace_id = task.workspace_id
        and member.user_id = (select auth.uid())
      where task.id = p_task_id
        and task.connector_platform = 'yunxiao'
        and task.kind = 'todo'
        and task.parent_task_id is null
        and task.deleted_at is null
        and connector.type = 'yunxiao'
        and connector.workspace_id = task.workspace_id
        and connector.public_config->>'kind' = 'quick_create'
    )
    and anttodo_private.can_view_task(p_task_id)
    and anttodo_private.can_organize_task(p_task_id)
$$;

revoke all on function anttodo_private.can_assign_quick_create_task(uuid) from public, anon;
grant execute on function anttodo_private.can_assign_quick_create_task(uuid) to authenticated;

-- This narrow write path is needed because external task content remains protected by RLS.
-- No caller-supplied actor or arbitrary task patch is accepted.
create or replace function anttodo_private.assign_quick_create_task(
  p_task_id uuid,
  p_assignee_id uuid,
  p_cli_assignee public.ai_cli_tool
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_task public.tasks;
begin
  select * into current_task from public.tasks where id = p_task_id for update;
  if not found or not anttodo_private.can_assign_quick_create_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode = '42501';
  end if;
  if p_assignee_id is not null and p_cli_assignee is not null then
    raise exception 'Choose either a member or a CLI assignee' using errcode = '23514';
  end if;
  if p_assignee_id is not null and (
    not exists (
      select 1 from public.workspace_members member
      where member.workspace_id = current_task.workspace_id and member.user_id = p_assignee_id
    ) or not anttodo_private.can_user_view_task(p_task_id, p_assignee_id)
  ) then
    raise exception 'Assignee must be a workspace member who can view the task' using errcode = '42501';
  end if;
  if p_cli_assignee is not null and not exists (
    select 1 from public.user_ai_work_settings settings
    where settings.user_id = (select auth.uid())
      and settings.workspace_id = current_task.workspace_id
      and p_cli_assignee = any(settings.cli_tools)
  ) then
    raise exception 'CLI must be enabled in AI work settings' using errcode = '42501';
  end if;
  if current_task.assignee_id is not distinct from p_assignee_id
    and current_task.cli_assignee is not distinct from p_cli_assignee then
    return current_task;
  end if;
  update public.tasks
    set assignee_id = p_assignee_id, cli_assignee = p_cli_assignee
    where id = p_task_id returning * into current_task;
  return current_task;
end;
$$;

revoke all on function anttodo_private.assign_quick_create_task(uuid, uuid, public.ai_cli_tool)
  from public, anon;
grant execute on function anttodo_private.assign_quick_create_task(uuid, uuid, public.ai_cli_tool)
  to authenticated;

create or replace function public.assign_task(
  p_task_id uuid,
  p_assignee_id uuid,
  p_cli_assignee public.ai_cli_tool default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_task public.tasks;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id;

  if found and anttodo_private.can_assign_quick_create_task(p_task_id) then
    return anttodo_private.assign_quick_create_task(p_task_id, p_assignee_id, p_cli_assignee);
  end if;

  if not found or not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  if current_task.kind = 'note'
    and (p_assignee_id is not null or p_cli_assignee is not null)
  then
    raise exception 'Notes cannot be assigned'
      using errcode = '42501';
  end if;

  if p_assignee_id is not null and p_cli_assignee is not null then
    raise exception 'Choose either a member or a CLI assignee'
      using errcode = '23514';
  end if;

  if p_assignee_id is not null
    and not anttodo_private.can_user_view_task(p_task_id, p_assignee_id)
  then
    raise exception 'Assignee must be a workspace member who can view the task'
      using errcode = '42501';
  end if;

  if p_cli_assignee is not null
    and not exists (
      select 1
      from public.user_ai_work_settings settings
      where settings.user_id = (select auth.uid())
        and settings.workspace_id = current_task.workspace_id
        and p_cli_assignee = any(settings.cli_tools)
    )
  then
    raise exception 'CLI must be enabled in AI work settings'
      using errcode = '42501';
  end if;

  if current_task.assignee_id is not distinct from p_assignee_id
    and current_task.cli_assignee is not distinct from p_cli_assignee
  then
    return current_task;
  end if;

  update public.tasks
  set assignee_id = p_assignee_id,
      cli_assignee = p_cli_assignee
  where id = p_task_id
  returning * into current_task;

  return current_task;
end;
$$;

create or replace function public.list_task_assignees(p_task_id uuid)
returns table(user_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not (anttodo_private.can_edit_task(p_task_id)
    or anttodo_private.can_assign_quick_create_task(p_task_id)) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  return query
  select wm.user_id
  from public.workspace_members wm
  join public.tasks t on t.workspace_id = wm.workspace_id
  where t.id = p_task_id
    and anttodo_private.can_user_view_task(p_task_id, wm.user_id);
end;
$$;

-- Assignment activity must accept the same narrow permission as the write RPC.
create or replace function anttodo_private.record_task_assignee_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (
      anttodo_private.can_edit_task(new.id)
      or anttodo_private.can_assign_quick_create_task(new.id)
      or (
        not exists (
          select 1
          from public.task_labels
          where task_id = new.id
        )
        and old.assignee_id = (select auth.uid())
      )
    )
  then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  insert into public.activity_events (
    workspace_id,
    task_id,
    actor_id,
    event_type,
    payload
  ) values (
    new.workspace_id,
    new.id,
    (select auth.uid()),
    'task.assignee_changed',
    jsonb_build_object(
      'previous_assignee_id', old.assignee_id,
      'assignee_id', new.assignee_id
    ) || case
      when old.cli_assignee is not null or new.cli_assignee is not null then
        jsonb_build_object(
          'previous_cli_assignee', old.cli_assignee,
          'cli_assignee', new.cli_assignee
        )
      else '{}'::jsonb
    end
  );

  return new;
end;
$$;

commit;
