create or replace function anttodo_private.can_edit_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.tasks t
      where t.id = target_task
        and (
          exists (
            select 1
            from public.task_labels tl
            where tl.task_id = t.id
          )
          or t.created_by = (select auth.uid())
          or t.assignee_id = (select auth.uid())
          or anttodo_private.is_workspace_admin(t.workspace_id)
        )
    )
    and not exists (
      select 1
      from public.task_labels tl
      where tl.task_id = target_task
        and anttodo_private.label_permission_level(tl.label_id) < 2
    );
$$;

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
