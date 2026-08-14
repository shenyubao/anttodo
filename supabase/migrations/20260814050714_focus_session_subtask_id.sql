alter table public.focus_sessions
  add column subtask_id uuid references public.subtasks(id) on delete set null;

alter table public.focus_sessions
  add constraint focus_sessions_subtask_requires_task
  check (subtask_id is null or task_id is not null);

create index focus_sessions_subtask_id_idx
  on public.focus_sessions (subtask_id);

create or replace function anttodo_private.validate_focus_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  task_workspace_id uuid;
  subtask_task_id uuid;
begin
  if new.user_id is distinct from (select auth.uid()) then
    raise exception 'Focus session must belong to the current user'
      using errcode = '42501';
  end if;

  if not anttodo_private.is_workspace_member(new.workspace_id) then
    raise exception 'Focus session requires workspace membership'
      using errcode = '42501';
  end if;

  if new.task_id is not null then
    select t.workspace_id
    into task_workspace_id
    from public.tasks t
    where t.id = new.task_id;

    if task_workspace_id is null then
      raise exception 'Focus session task does not exist'
        using errcode = '23503';
    end if;

    if task_workspace_id is distinct from new.workspace_id then
      raise exception 'Focus session task must belong to the same workspace'
        using errcode = '23514';
    end if;

    if not anttodo_private.can_view_task(new.task_id) then
      raise exception 'Focus session task is not visible to the current user'
        using errcode = '42501';
    end if;
  end if;

  if new.subtask_id is not null then
    select s.task_id
    into subtask_task_id
    from public.subtasks s
    where s.id = new.subtask_id;

    if subtask_task_id is null then
      raise exception 'Focus session subtask does not exist'
        using errcode = '23503';
    end if;

    if subtask_task_id is distinct from new.task_id then
      raise exception 'Focus session subtask must belong to the linked task'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
