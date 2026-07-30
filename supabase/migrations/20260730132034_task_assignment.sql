create or replace function anttodo_private.label_permission_level_for_user(
  target_label uuid,
  target_user uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_label public.labels%rowtype;
  local_level integer;
  effective_level integer := 2;
begin
  if target_user is null then
    return 0;
  end if;

  select *
  into current_label
  from public.labels
  where id = target_label;

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.workspace_members
    where workspace_id = current_label.workspace_id
      and user_id = target_user
      and role in ('owner', 'admin')
  ) then
    return 2;
  end if;

  loop
    local_level := case current_label.visibility
      when 'private' then
        case when current_label.created_by = target_user then 2 else 0 end
      when 'restricted' then greatest(
        case when current_label.created_by = target_user then 2 else 0 end,
        coalesce((
          select case permission when 'edit' then 2 else 1 end
          from public.label_acl
          where label_id = current_label.id
            and user_id = target_user
        ), 0)
      )
      else case
        when not exists (
          select 1
          from public.workspace_members
          where workspace_id = current_label.workspace_id
            and user_id = target_user
        ) then 0
        when current_label.created_by = target_user then 2
        else greatest(
          1,
          coalesce((
            select case permission when 'edit' then 2 else 1 end
            from public.label_acl
            where label_id = current_label.id
              and user_id = target_user
          ), 0)
        )
      end
    end;

    effective_level := least(effective_level, local_level);
    exit when effective_level = 0
      or not current_label.inherit_permissions
      or current_label.parent_id is null;

    select *
    into current_label
    from public.labels
    where id = current_label.parent_id;
    exit when not found;
  end loop;

  return effective_level;
end;
$$;

create or replace function anttodo_private.can_user_view_task(
  target_task uuid,
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user is not null
    and exists (
      select 1
      from public.tasks t
      join public.workspace_members wm
        on wm.workspace_id = t.workspace_id
       and wm.user_id = target_user
      where t.id = target_task
    )
    and not exists (
      select 1
      from public.task_labels tl
      where tl.task_id = target_task
        and anttodo_private.label_permission_level_for_user(
          tl.label_id,
          target_user
        ) < 1
    );
$$;

revoke all on function anttodo_private.label_permission_level_for_user(uuid, uuid)
from public, anon;
revoke all on function anttodo_private.can_user_view_task(uuid, uuid)
from public, anon;
grant execute on function anttodo_private.label_permission_level_for_user(uuid, uuid)
to authenticated;
grant execute on function anttodo_private.can_user_view_task(uuid, uuid)
to authenticated;

create or replace function anttodo_private.validate_task_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assignee_id is not null
    and not anttodo_private.can_user_view_task(new.id, new.assignee_id)
  then
    raise exception 'Assignee must be a workspace member who can view the task'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function anttodo_private.record_task_assignee_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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
    )
  );

  return new;
end;
$$;

drop trigger if exists tasks_validate_assignee on public.tasks;
create trigger tasks_validate_assignee
before update of assignee_id on public.tasks
for each row
when (old.assignee_id is distinct from new.assignee_id)
execute function anttodo_private.validate_task_assignee();

drop trigger if exists tasks_record_assignee_change on public.tasks;
create trigger tasks_record_assignee_change
after update of assignee_id on public.tasks
for each row
when (old.assignee_id is distinct from new.assignee_id)
execute function anttodo_private.record_task_assignee_change();

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and assignee_id is null
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create or replace function public.list_task_assignees(p_task_id uuid)
returns table(user_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not anttodo_private.can_edit_task(p_task_id) then
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

create or replace function public.assign_task(
  p_task_id uuid,
  p_assignee_id uuid
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_task public.tasks;
begin
  select *
  into current_task
  from public.tasks
  where id = p_task_id;

  if not found or not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  if p_assignee_id is not null
    and not anttodo_private.can_user_view_task(p_task_id, p_assignee_id)
  then
    raise exception 'Assignee must be a workspace member who can view the task'
      using errcode = '42501';
  end if;

  if current_task.assignee_id is not distinct from p_assignee_id then
    return current_task;
  end if;

  update public.tasks
  set assignee_id = p_assignee_id
  where id = p_task_id
  returning * into current_task;

  return current_task;
end;
$$;

revoke all on function public.list_task_assignees(uuid) from public, anon;
revoke all on function public.assign_task(uuid, uuid) from public, anon;
grant execute on function public.list_task_assignees(uuid) to authenticated;
grant execute on function public.assign_task(uuid, uuid) to authenticated;

create or replace function public.create_task_with_labels(
  p_workspace_id uuid,
  p_title text,
  p_label_ids uuid[],
  p_description text default '',
  p_due_at timestamptz default null,
  p_priority public.task_priority default 'none',
  p_assignee_id uuid default null,
  p_due_timezone text default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_task public.tasks;
  label_id uuid;
begin
  foreach label_id in array coalesce(p_label_ids, array[]::uuid[]) loop
    if anttodo_private.label_permission_level(label_id) < 2
      or not exists (
        select 1
        from public.labels
        where id = label_id
          and workspace_id = p_workspace_id
      ) then
      raise exception 'Insufficient label permission';
    end if;
  end loop;

  created_task.id := extensions.gen_random_uuid();

  insert into public.tasks (
    id,
    workspace_id,
    title,
    description,
    due_at,
    due_timezone,
    priority,
    assignee_id,
    created_by
  ) values (
    created_task.id,
    p_workspace_id,
    p_title,
    coalesce(p_description, ''),
    p_due_at,
    p_due_timezone,
    p_priority,
    null,
    (select auth.uid())
  );

  insert into public.task_labels (task_id, label_id)
  select created_task.id, unnest(coalesce(p_label_ids, array[]::uuid[]));

  if p_assignee_id is not null then
    update public.tasks
    set assignee_id = p_assignee_id
    where id = created_task.id;
  end if;

  select *
  into created_task
  from public.tasks
  where tasks.id = created_task.id;

  insert into public.activity_events (
    workspace_id,
    task_id,
    actor_id,
    event_type
  ) values (
    p_workspace_id,
    created_task.id,
    (select auth.uid()),
    'task.created'
  );

  return created_task;
end;
$$;

revoke all on function public.create_task_with_labels(
  uuid,
  text,
  uuid[],
  text,
  timestamptz,
  public.task_priority,
  uuid,
  text
) from public, anon;

grant execute on function public.create_task_with_labels(
  uuid,
  text,
  uuid[],
  text,
  timestamptz,
  public.task_priority,
  uuid,
  text
) to authenticated;
