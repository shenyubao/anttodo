create or replace function public.create_task_with_labels(
  p_workspace_id uuid,
  p_title text,
  p_label_ids uuid[],
  p_description text default '',
  p_due_at timestamptz default null,
  p_priority public.task_priority default 'none',
  p_assignee_id uuid default null,
  p_due_timezone text default null,
  p_kind public.task_kind default 'todo'
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_task public.tasks;
  label_id uuid;
  creator_id uuid := (select auth.uid());
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
    kind,
    assignee_id,
    created_by
  ) values (
    created_task.id,
    p_workspace_id,
    p_title,
    coalesce(p_description, ''),
    p_due_at,
    p_due_timezone,
    case when p_kind = 'note' then 'none'::public.task_priority else p_priority end,
    p_kind,
    null,
    creator_id
  );

  insert into public.task_labels (task_id, label_id)
  select created_task.id, unnest(coalesce(p_label_ids, array[]::uuid[]));

  if p_assignee_id is not null then
    update public.tasks
    set assignee_id = p_assignee_id
    where id = created_task.id;
  end if;

  -- When the creator is not self-assigned, watch the task as a participant.
  if p_assignee_id is distinct from creator_id then
    insert into public.task_participants (task_id, user_id)
    values (created_task.id, creator_id);
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
    creator_id,
    'task.created'
  );

  return created_task;
end;
$$;
