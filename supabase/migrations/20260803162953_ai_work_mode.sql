create type public.ai_cli_tool as enum ('codex', 'claude');

create table public.user_ai_work_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cli_tools public.ai_cli_tool[] not null default '{}'::public.ai_cli_tool[],
  default_working_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id),
  constraint user_ai_work_settings_path_check check (
    (
      cardinality(cli_tools) = 0
      and (default_working_path is null or char_length(btrim(default_working_path)) > 0)
    )
    or (
      cardinality(cli_tools) > 0
      and default_working_path is not null
      and char_length(btrim(default_working_path)) > 0
    )
  )
);

create trigger user_ai_work_settings_updated_at
before update on public.user_ai_work_settings
for each row execute function anttodo_private.set_updated_at();

alter table public.user_ai_work_settings enable row level security;

create policy user_ai_work_settings_select_self
on public.user_ai_work_settings for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy user_ai_work_settings_insert_self
on public.user_ai_work_settings for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy user_ai_work_settings_update_self
on public.user_ai_work_settings for update to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

grant select, insert, update on public.user_ai_work_settings to authenticated;

alter table public.tasks
  add column cli_assignee public.ai_cli_tool,
  add constraint tasks_assignee_kind_check check (
    assignee_id is null or cli_assignee is null
  );

alter table public.subtasks
  add column cli_assignee public.ai_cli_tool,
  add constraint subtasks_assignee_kind_check check (
    assignee_id is null or cli_assignee is null
  );

create or replace function anttodo_private.validate_task_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'note' then
    new.assignee_id := null;
    new.cli_assignee := null;
    return new;
  end if;

  if new.assignee_id is not null and new.cli_assignee is not null then
    raise exception 'A task cannot be assigned to a member and a CLI at the same time'
      using errcode = '23514';
  end if;

  if new.assignee_id is not null
    and not anttodo_private.can_user_view_task(new.id, new.assignee_id)
  then
    raise exception 'Assignee must be a workspace member who can view the task'
      using errcode = '42501';
  end if;

  if new.cli_assignee is not null
    and new.cli_assignee is distinct from old.cli_assignee
    and not exists (
      select 1
      from public.user_ai_work_settings settings
      where settings.user_id = (select auth.uid())
        and settings.workspace_id = new.workspace_id
        and new.cli_assignee = any(settings.cli_tools)
    )
  then
    raise exception 'CLI must be enabled in AI work settings'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_validate_assignee on public.tasks;
create trigger tasks_validate_assignee
before update of assignee_id, cli_assignee, kind on public.tasks
for each row execute function anttodo_private.validate_task_assignee();

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

drop trigger if exists tasks_record_assignee_change on public.tasks;
create trigger tasks_record_assignee_change
after update of assignee_id, cli_assignee on public.tasks
for each row
when (
  old.assignee_id is distinct from new.assignee_id
  or old.cli_assignee is distinct from new.cli_assignee
)
execute function anttodo_private.record_task_assignee_change();

create or replace function anttodo_private.validate_subtask_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_task public.tasks;
begin
  select * into parent_task
  from public.tasks
  where id = new.task_id;

  if not found or parent_task.kind = 'note' then
    if new.assignee_id is not null or new.cli_assignee is not null then
      raise exception 'Notes cannot have assigned subtasks'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.assignee_id is not null and new.cli_assignee is not null then
    raise exception 'A subtask cannot be assigned to a member and a CLI at the same time'
      using errcode = '23514';
  end if;

  if new.assignee_id is not null
    and not anttodo_private.can_user_view_task(new.task_id, new.assignee_id)
  then
    raise exception 'Subtask assignee must be able to view its parent task'
      using errcode = '42501';
  end if;

  if new.cli_assignee is not null
    and (tg_op = 'INSERT' or new.cli_assignee is distinct from old.cli_assignee)
    and not exists (
      select 1
      from public.user_ai_work_settings settings
      where settings.user_id = (select auth.uid())
        and settings.workspace_id = parent_task.workspace_id
        and new.cli_assignee = any(settings.cli_tools)
    )
  then
    raise exception 'CLI must be enabled in AI work settings'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists subtasks_validate_assignee on public.subtasks;
create trigger subtasks_validate_assignee
before insert or update of assignee_id, cli_assignee, task_id on public.subtasks
for each row execute function anttodo_private.validate_subtask_assignee();

create or replace function anttodo_private.clear_note_subtask_assignments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'note' and old.kind is distinct from new.kind then
    update public.subtasks
    set assignee_id = null,
        cli_assignee = null
    where task_id = new.id
      and (assignee_id is not null or cli_assignee is not null);
  end if;
  return new;
end;
$$;

create trigger tasks_clear_note_subtask_assignments
after update of kind on public.tasks
for each row execute function anttodo_private.clear_note_subtask_assignments();

drop function if exists public.assign_task(uuid, uuid);

create function public.assign_task(
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

create function public.assign_subtask(
  p_subtask_id uuid,
  p_assignee_id uuid,
  p_cli_assignee public.ai_cli_tool default null
)
returns public.subtasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_subtask public.subtasks;
  parent_task public.tasks;
begin
  select * into current_subtask
  from public.subtasks
  where id = p_subtask_id;

  if not found then
    raise exception 'Subtask not found'
      using errcode = '42501';
  end if;

  select * into parent_task
  from public.tasks
  where id = current_subtask.task_id;

  if not found or not anttodo_private.can_edit_task(parent_task.id) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  if parent_task.kind = 'note' then
    raise exception 'Notes cannot have assigned subtasks'
      using errcode = '42501';
  end if;

  if p_assignee_id is not null and p_cli_assignee is not null then
    raise exception 'Choose either a member or a CLI assignee'
      using errcode = '23514';
  end if;

  if p_assignee_id is not null
    and not anttodo_private.can_user_view_task(parent_task.id, p_assignee_id)
  then
    raise exception 'Subtask assignee must be able to view its parent task'
      using errcode = '42501';
  end if;

  if p_cli_assignee is not null
    and not exists (
      select 1
      from public.user_ai_work_settings settings
      where settings.user_id = (select auth.uid())
        and settings.workspace_id = parent_task.workspace_id
        and p_cli_assignee = any(settings.cli_tools)
    )
  then
    raise exception 'CLI must be enabled in AI work settings'
      using errcode = '42501';
  end if;

  update public.subtasks
  set assignee_id = p_assignee_id,
      cli_assignee = p_cli_assignee
  where id = p_subtask_id
  returning * into current_subtask;

  return current_subtask;
end;
$$;

revoke all on function public.assign_task(uuid, uuid, public.ai_cli_tool) from public, anon;
revoke all on function public.assign_subtask(uuid, uuid, public.ai_cli_tool) from public, anon;
grant execute on function public.assign_task(uuid, uuid, public.ai_cli_tool) to authenticated;
grant execute on function public.assign_subtask(uuid, uuid, public.ai_cli_tool) to authenticated;

create or replace function anttodo_private.record_subtask_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_task_id uuid := coalesce(new.task_id, old.task_id);
  selected_workspace_id uuid;
  changes jsonb := '{}'::jsonb;
  selected_event_type text;
  selected_payload jsonb;
begin
  select t.workspace_id into selected_workspace_id from public.tasks t where t.id = selected_task_id;
  if selected_workspace_id is null then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    selected_event_type := 'task.subtask_created';
    selected_payload := jsonb_build_object('subtask_id', new.id, 'title', new.title, 'completed', new.completed);
  elsif tg_op = 'DELETE' then
    selected_event_type := 'task.subtask_deleted';
    selected_payload := jsonb_build_object('subtask_id', old.id, 'title', old.title, 'completed', old.completed);
  else
    if old.title is distinct from new.title then
      changes := changes || jsonb_build_object('title', jsonb_build_object('before', old.title, 'after', new.title));
    end if;
    if old.completed is distinct from new.completed then
      changes := changes || jsonb_build_object('completed', jsonb_build_object('before', old.completed, 'after', new.completed));
    end if;
    if old.due_at is distinct from new.due_at then
      changes := changes || jsonb_build_object('due_at', jsonb_build_object('before', old.due_at, 'after', new.due_at));
    end if;
    if old.assignee_id is distinct from new.assignee_id then
      changes := changes || jsonb_build_object('assignee_id', jsonb_build_object('before', old.assignee_id, 'after', new.assignee_id));
    end if;
    if old.cli_assignee is distinct from new.cli_assignee then
      changes := changes || jsonb_build_object('cli_assignee', jsonb_build_object('before', old.cli_assignee, 'after', new.cli_assignee));
    end if;
    if changes = '{}'::jsonb then return new; end if;
    selected_event_type := 'task.subtask_updated';
    selected_payload := jsonb_build_object('subtask_id', new.id, 'title', new.title, 'changes', changes);
  end if;

  insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
  values (selected_workspace_id, selected_task_id, (select auth.uid()), selected_event_type, selected_payload);
  return coalesce(new, old);
end;
$$;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and assignee_id is null
  and cli_assignee is null
  and (select anttodo_private.is_workspace_member(workspace_id))
);
