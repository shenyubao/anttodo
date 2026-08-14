create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  subtask_id uuid references public.subtasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_subtask_id uuid references public.subtasks(id) on delete cascade,
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_dependencies_not_self check (
    task_id is distinct from depends_on_task_id
    or subtask_id is distinct from depends_on_subtask_id
  )
);

create unique index task_dependencies_unique_idx
  on public.task_dependencies (
    task_id,
    coalesce(subtask_id, '00000000-0000-0000-0000-000000000000'::uuid),
    depends_on_task_id,
    coalesce(depends_on_subtask_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index task_dependencies_task_idx
  on public.task_dependencies(task_id, subtask_id, position);

create index task_dependencies_depends_on_idx
  on public.task_dependencies(depends_on_task_id, depends_on_subtask_id);

create or replace function anttodo_private.task_dependency_would_cycle(
  p_from_task uuid,
  p_from_subtask uuid,
  p_to_task uuid,
  p_to_subtask uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive walk as (
    select
      d.depends_on_task_id as task_id,
      d.depends_on_subtask_id as subtask_id,
      1 as depth
    from public.task_dependencies d
    where d.task_id = p_from_task
      and d.subtask_id is not distinct from p_from_subtask
    union all
    select
      d.depends_on_task_id,
      d.depends_on_subtask_id,
      walk.depth + 1
    from public.task_dependencies d
    join walk
      on d.task_id = walk.task_id
     and d.subtask_id is not distinct from walk.subtask_id
    where walk.depth < 64
  )
  select exists (
    select 1
    from walk
    where walk.task_id = p_to_task
      and walk.subtask_id is not distinct from p_to_subtask
  );
$$;

revoke all on function anttodo_private.task_dependency_would_cycle(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function anttodo_private.task_dependency_would_cycle(uuid, uuid, uuid, uuid) to authenticated;

create or replace function anttodo_private.validate_task_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  successor public.tasks;
  predecessor public.tasks;
begin
  select * into successor from public.tasks where id = new.task_id;
  if not found then
    raise exception 'Successor task not found' using errcode = '23503';
  end if;
  select * into predecessor from public.tasks where id = new.depends_on_task_id;
  if not found then
    raise exception 'Predecessor task not found' using errcode = '23503';
  end if;

  new.workspace_id := successor.workspace_id;
  if predecessor.workspace_id is distinct from successor.workspace_id then
    raise exception 'Dependency must stay in the same workspace' using errcode = '23514';
  end if;

  if new.subtask_id is not null and not exists (
    select 1 from public.subtasks s
    where s.id = new.subtask_id and s.task_id = new.task_id
  ) then
    raise exception 'Subtask does not belong to successor task' using errcode = '23514';
  end if;

  if new.depends_on_subtask_id is not null and not exists (
    select 1 from public.subtasks s
    where s.id = new.depends_on_subtask_id and s.task_id = new.depends_on_task_id
  ) then
    raise exception 'Subtask does not belong to predecessor task' using errcode = '23514';
  end if;

  if new.task_id = new.depends_on_task_id
    and new.subtask_id is not distinct from new.depends_on_subtask_id
  then
    raise exception 'A task cannot depend on itself' using errcode = '23514';
  end if;

  if anttodo_private.task_dependency_would_cycle(
    new.depends_on_task_id,
    new.depends_on_subtask_id,
    new.task_id,
    new.subtask_id
  ) then
    raise exception 'Dependency would create a cycle' using errcode = '23514';
  end if;

  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;

  if tg_op = 'INSERT' and new.position = 0 then
    select coalesce(max(d.position), -1) + 1 into new.position
    from public.task_dependencies d
    where d.task_id = new.task_id
      and d.subtask_id is not distinct from new.subtask_id;
  end if;

  return new;
end;
$$;

create trigger task_dependencies_validate
  before insert or update on public.task_dependencies
  for each row execute function anttodo_private.validate_task_dependency();

alter table public.task_dependencies enable row level security;

create policy task_dependencies_select on public.task_dependencies
  for select to authenticated
  using (anttodo_private.can_view_task(task_id));

create policy task_dependencies_insert on public.task_dependencies
  for insert to authenticated
  with check (
    anttodo_private.can_edit_task(task_id)
    and anttodo_private.can_view_task(depends_on_task_id)
  );

create policy task_dependencies_delete on public.task_dependencies
  for delete to authenticated
  using (anttodo_private.can_edit_task(task_id));

grant select, insert, delete on public.task_dependencies to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_dependencies'
    )
  then
    alter publication supabase_realtime add table public.task_dependencies;
  end if;
end;
$$;

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
          id, task_id, title, position, created_by, priority, due_at, due_start_at,
          due_is_all_day, due_timezone, assignee_id, cli_assignee
        )
        values (
          (op ->> 'entityId')::uuid,
          (op -> 'payload' ->> 'taskId')::uuid,
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
