create or replace function anttodo_private.is_task_creator(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.tasks
      where id = target_task
        and created_by = (select auth.uid())
    );
$$;

revoke all on function anttodo_private.is_task_creator(uuid) from public, anon;
grant execute on function anttodo_private.is_task_creator(uuid) to authenticated;

alter policy task_labels_insert
on public.task_labels
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (
    (select anttodo_private.is_task_creator(task_id))
    or (select anttodo_private.can_edit_task(task_id))
  )
);

create or replace function public.create_task_with_labels(
  p_workspace_id uuid,
  p_title text,
  p_label_ids uuid[],
  p_description text default '',
  p_due_at timestamptz default null,
  p_priority public.task_priority default 'none',
  p_assignee_id uuid default null
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
  if coalesce(array_length(p_label_ids, 1), 0) = 0 then
    raise exception 'At least one label is required';
  end if;

  foreach label_id in array p_label_ids loop
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
    id, workspace_id, title, description, due_at, priority, assignee_id, created_by
  ) values (
    created_task.id, p_workspace_id, p_title, coalesce(p_description, ''),
    p_due_at, p_priority, p_assignee_id, (select auth.uid())
  );

  insert into public.task_labels (task_id, label_id)
  select created_task.id, unnest(p_label_ids);

  select *
  into created_task
  from public.tasks
  where tasks.id = created_task.id;

  insert into public.activity_events (workspace_id, task_id, actor_id, event_type)
  values (p_workspace_id, created_task.id, (select auth.uid()), 'task.created');

  return created_task;
end;
$$;
