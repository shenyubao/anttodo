-- Nested subtasks: parent_subtask_id under the same task, max depth 5
-- (root task is level 1; top-level subtasks are level 2).

alter table public.subtasks
  add column if not exists parent_subtask_id uuid references public.subtasks(id) on delete cascade;

create index if not exists subtasks_parent_position_idx
  on public.subtasks(task_id, parent_subtask_id, position);

create or replace function anttodo_private.enforce_subtask_nesting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cursor_id uuid;
  next_id uuid;
  parent_task uuid;
  node_depth integer;
  extra_depth integer;
  seen uuid[];
begin
  if new.parent_subtask_id is null then
    node_depth := 2;
  else
    if new.parent_subtask_id = new.id then
      raise exception 'Subtask cannot be its own parent' using errcode = '23514';
    end if;

    select s.task_id into parent_task
    from public.subtasks s
    where s.id = new.parent_subtask_id;

    if parent_task is null then
      raise exception 'Parent subtask does not exist' using errcode = '23503';
    end if;
    if parent_task is distinct from new.task_id then
      raise exception 'Parent subtask must belong to the same task' using errcode = '23514';
    end if;

    node_depth := 2;
    cursor_id := new.parent_subtask_id;
    seen := array[new.id];

    while cursor_id is not null loop
      if cursor_id = any(seen) then
        raise exception 'Subtask nesting cannot contain a cycle' using errcode = '23514';
      end if;
      if node_depth >= 5 then
        raise exception 'Subtask nesting cannot exceed 5 levels' using errcode = '23514';
      end if;
      node_depth := node_depth + 1;
      seen := seen || cursor_id;
      select s.parent_subtask_id into next_id
      from public.subtasks s
      where s.id = cursor_id;
      if not found then
        exit;
      end if;
      cursor_id := next_id;
    end loop;
  end if;

  if tg_op = 'UPDATE' and new.parent_subtask_id is distinct from old.parent_subtask_id then
    with recursive descendants as (
      select s.id, 0 as extra
      from public.subtasks s
      where s.id = new.id
      union all
      select child.id, descendants.extra + 1
      from descendants
      join public.subtasks child on child.parent_subtask_id = descendants.id
    )
    select coalesce(max(extra), 0) into extra_depth from descendants;

    if node_depth + extra_depth > 5 then
      raise exception 'Subtask nesting cannot exceed 5 levels' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists subtasks_enforce_nesting on public.subtasks;
create trigger subtasks_enforce_nesting
  before insert or update of parent_subtask_id, task_id
  on public.subtasks
  for each row
  execute function anttodo_private.enforce_subtask_nesting();

create or replace function public.apply_client_operations(p_operations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op jsonb; result jsonb := '[]'::jsonb; existing jsonb; target_workspace uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_operations, '[]'::jsonb)) > 50 then raise exception 'Too many operations' using errcode = '22023'; end if;
  for op in select value from jsonb_array_elements(coalesce(p_operations, '[]'::jsonb)) loop
    target_workspace := (op ->> 'workspaceId')::uuid;
    if not anttodo_private.is_workspace_member(target_workspace) then
      result := result || jsonb_build_array(jsonb_build_object('operationId', op ->> 'operationId', 'status', 'rejected', 'code', 'WORKSPACE_ACCESS_REVOKED'));
      continue;
    end if;
    select a.result into existing from anttodo_private.client_applied_operations a
      where a.operation_id = (op ->> 'operationId')::uuid and a.user_id = (select auth.uid());
    if existing is not null then result := result || jsonb_build_array(existing); continue; end if;

    if op ->> 'entityType' = 'tasks' then
      if (op ->> 'baseVersion') is not null and not exists (
        select 1 from public.tasks t where t.id = (op ->> 'entityId')::uuid and t.version = (op ->> 'baseVersion')::bigint
      ) then
        existing := jsonb_build_object('operationId', op ->> 'operationId', 'status', 'conflict', 'code', 'VERSION_CONFLICT');
        insert into public.client_sync_conflicts(workspace_id, device_id, entity_type, entity_id, operation_id, local_payload, remote_payload)
          select target_workspace, (op ->> 'deviceId')::uuid, 'tasks', (op ->> 'entityId')::uuid,
            (op ->> 'operationId')::uuid, op -> 'payload', coalesce(to_jsonb(t), '{}'::jsonb)
          from public.tasks t where t.id = (op ->> 'entityId')::uuid;
        insert into anttodo_private.client_applied_operations(operation_id, user_id, workspace_id, result)
          values ((op ->> 'operationId')::uuid, (select auth.uid()), target_workspace, existing);
        result := result || jsonb_build_array(existing);
        continue;
      end if;
      if exists (select 1 from public.tasks t where t.id = (op ->> 'entityId')::uuid) then
        update public.tasks t set
          title = coalesce(op -> 'payload' ->> 'title', t.title),
          description = coalesce(op -> 'payload' ->> 'description', t.description),
          status = coalesce((op -> 'payload' ->> 'status')::public.task_status, t.status),
          priority = coalesce((op -> 'payload' ->> 'priority')::public.task_priority, t.priority),
          due_at = case when op -> 'payload' ? 'due_at' then (op -> 'payload' ->> 'due_at')::timestamptz else t.due_at end,
          assignee_id = case when op -> 'payload' ? 'assignee_id' then (op -> 'payload' ->> 'assignee_id')::uuid else t.assignee_id end,
          updated_at = now()
        where t.id = (op ->> 'entityId')::uuid and t.workspace_id = target_workspace;
      else
        insert into public.tasks(id, workspace_id, title, description, status, priority, due_at, assignee_id, created_by)
        values (
          (op ->> 'entityId')::uuid, target_workspace,
          coalesce(op -> 'payload' ->> 'title', '新任务'),
          coalesce(op -> 'payload' ->> 'description', ''),
          coalesce((op -> 'payload' ->> 'status')::public.task_status, 'open'),
          coalesce((op -> 'payload' ->> 'priority')::public.task_priority, 'none'),
          (op -> 'payload' ->> 'due_at')::timestamptz,
          (op -> 'payload' ->> 'assignee_id')::uuid,
          (select auth.uid())
        );
        if jsonb_typeof(op -> 'payload' -> 'label_ids') = 'array' then
          insert into public.task_labels(task_id, label_id)
          select (op ->> 'entityId')::uuid, value::uuid
          from jsonb_array_elements_text(op -> 'payload' -> 'label_ids')
          on conflict do nothing;
        end if;
      end if;
    elsif op ->> 'entityType' = 'labels' then
      update public.labels l set
        name = coalesce(op -> 'payload' ->> 'name', l.name),
        color = coalesce(op -> 'payload' ->> 'color', l.color),
        position = coalesce((op -> 'payload' ->> 'position')::integer, l.position),
        updated_at = now()
      where l.id = (op ->> 'entityId')::uuid and l.workspace_id = target_workspace;
    elsif op ->> 'entityType' = 'subtasks' then
      if coalesce((op -> 'payload' ->> 'deleted')::boolean, false) then
        delete from public.subtasks where id = (op ->> 'entityId')::uuid
          and exists (select 1 from public.tasks t where t.id = subtasks.task_id and t.workspace_id = target_workspace);
      elsif exists (select 1 from public.subtasks s where s.id = (op ->> 'entityId')::uuid) then
        update public.subtasks s set
          title = coalesce(op -> 'payload' ->> 'title', s.title),
          completed = coalesce((op -> 'payload' ->> 'completed')::boolean, s.completed),
          position = coalesce((op -> 'payload' ->> 'position')::integer, s.position),
          priority = coalesce((op -> 'payload' ->> 'priority')::public.task_priority, s.priority),
          parent_subtask_id = case
            when op -> 'payload' ? 'parent_subtask_id'
              then (op -> 'payload' ->> 'parent_subtask_id')::uuid
            else s.parent_subtask_id
          end,
          due_at = case when op -> 'payload' ? 'due_at' then (op -> 'payload' ->> 'due_at')::timestamptz else s.due_at end,
          due_start_at = case when op -> 'payload' ? 'due_start_at' then (op -> 'payload' ->> 'due_start_at')::timestamptz else s.due_start_at end,
          due_is_all_day = case when op -> 'payload' ? 'due_is_all_day' then coalesce((op -> 'payload' ->> 'due_is_all_day')::boolean, false) else s.due_is_all_day end,
          due_timezone = case when op -> 'payload' ? 'due_timezone' then op -> 'payload' ->> 'due_timezone' else s.due_timezone end,
          estimate_hours = case when op -> 'payload' ? 'estimate_hours' then (op -> 'payload' ->> 'estimate_hours')::numeric else s.estimate_hours end,
          actual_hours = case when op -> 'payload' ? 'actual_hours' then (op -> 'payload' ->> 'actual_hours')::numeric else s.actual_hours end,
          estimate_pomodoros = case when op -> 'payload' ? 'estimate_pomodoros' then (op -> 'payload' ->> 'estimate_pomodoros')::integer else s.estimate_pomodoros end,
          actual_pomodoros = case when op -> 'payload' ? 'actual_pomodoros' then (op -> 'payload' ->> 'actual_pomodoros')::integer else s.actual_pomodoros end,
          updated_at = now()
        where s.id = (op ->> 'entityId')::uuid
          and exists (select 1 from public.tasks t where t.id = s.task_id and t.workspace_id = target_workspace);
      else
        insert into public.subtasks(
          id, task_id, parent_subtask_id, title, position, created_by, priority, due_at, due_start_at,
          due_is_all_day, due_timezone, assignee_id, cli_assignee
        )
        values (
          (op ->> 'entityId')::uuid,
          (op -> 'payload' ->> 'taskId')::uuid,
          (op -> 'payload' ->> 'parent_subtask_id')::uuid,
          coalesce(op -> 'payload' ->> 'title', ''),
          coalesce((op -> 'payload' ->> 'position')::integer, 0),
          (select auth.uid()),
          coalesce((op -> 'payload' ->> 'priority')::public.task_priority, 'none'),
          (op -> 'payload' ->> 'due_at')::timestamptz,
          (op -> 'payload' ->> 'due_start_at')::timestamptz,
          coalesce((op -> 'payload' ->> 'due_is_all_day')::boolean, false),
          op -> 'payload' ->> 'due_timezone',
          (op -> 'payload' ->> 'assignee_id')::uuid,
          op -> 'payload' ->> 'cli_assignee'
        );
      end if;
    elsif op ->> 'entityType' = 'subtask_schedule' then
      perform public.save_subtask_schedule(
        (op ->> 'entityId')::uuid,
        (op -> 'payload' ->> 'due_at')::timestamptz,
        (op -> 'payload' ->> 'due_start_at')::timestamptz,
        coalesce((op -> 'payload' ->> 'due_is_all_day')::boolean, false),
        op -> 'payload' ->> 'due_timezone',
        coalesce(op -> 'payload' -> 'schedule' -> 'reminders', '[]'::jsonb),
        coalesce((op -> 'payload' -> 'schedule' ->> 'persistent')::boolean, false)
      );
    elsif op ->> 'entityType' = 'task_labels' then
      if coalesce((op -> 'payload' ->> 'selected')::boolean, false) then
        insert into public.task_labels(task_id, label_id)
        values ((op -> 'payload' ->> 'taskId')::uuid, (op -> 'payload' ->> 'labelId')::uuid)
        on conflict do nothing;
      else
        delete from public.task_labels
        where task_id = (op -> 'payload' ->> 'taskId')::uuid
          and label_id = (op -> 'payload' ->> 'labelId')::uuid;
      end if;
    elsif op ->> 'entityType' = 'task_dependencies' then
      if coalesce((op -> 'payload' ->> 'selected')::boolean, false) then
        insert into public.task_dependencies(
          id, workspace_id, task_id, subtask_id, depends_on_task_id, depends_on_subtask_id
        )
        values (
          (op ->> 'entityId')::uuid,
          target_workspace,
          (op -> 'payload' ->> 'taskId')::uuid,
          (op -> 'payload' ->> 'subtaskId')::uuid,
          (op -> 'payload' ->> 'dependsOnTaskId')::uuid,
          (op -> 'payload' ->> 'dependsOnSubtaskId')::uuid
        )
        on conflict do nothing;
      else
        delete from public.task_dependencies
        where id = (op ->> 'entityId')::uuid
          and workspace_id = target_workspace;
      end if;
    elsif op ->> 'entityType' = 'task_comments' then
      if coalesce((op -> 'payload' ->> 'deleted')::boolean, false) then
        delete from public.task_comments where id = (op ->> 'entityId')::uuid and author_id = (select auth.uid());
      elsif exists (select 1 from public.task_comments c where c.id = (op ->> 'entityId')::uuid) then
        update public.task_comments c set
          body = coalesce(op -> 'payload' ->> 'body', c.body),
          image_uris = case when op -> 'payload' ? 'imageUris'
            then array(select jsonb_array_elements_text(op -> 'payload' -> 'imageUris'))
            else c.image_uris end,
          updated_at = now()
        where c.id = (op ->> 'entityId')::uuid and c.author_id = (select auth.uid());
      else
        insert into public.task_comments(id, workspace_id, task_id, subtask_id, author_id, body, image_uris)
        values (
          (op ->> 'entityId')::uuid, target_workspace, (op -> 'payload' ->> 'taskId')::uuid,
          (op -> 'payload' ->> 'subtaskId')::uuid,
          (select auth.uid()), coalesce(op -> 'payload' ->> 'body', ''),
          case when op -> 'payload' ? 'imageUris'
            then array(select jsonb_array_elements_text(op -> 'payload' -> 'imageUris'))
            else array[]::text[] end
        );
        if jsonb_typeof(op -> 'payload' -> 'mentionedUserIds') = 'array' then
          insert into public.task_comment_mentions(comment_id, user_id, display_name_snapshot)
          select (op ->> 'entityId')::uuid, member.user_id,
            coalesce(profile.display_name, '团队成员')
          from jsonb_array_elements_text(op -> 'payload' -> 'mentionedUserIds') mention
          join public.workspace_members member
            on member.workspace_id = target_workspace and member.user_id = mention.value::uuid
          left join public.profiles profile on profile.id = member.user_id
          on conflict do nothing;
        end if;
      end if;
    end if;
    existing := jsonb_build_object('operationId', op ->> 'operationId', 'status', 'applied');
    insert into anttodo_private.client_applied_operations(operation_id, user_id, workspace_id, result)
      values ((op ->> 'operationId')::uuid, (select auth.uid()), target_workspace, existing);
    result := result || jsonb_build_array(existing);
  end loop;
  return result;
end;
$$;
