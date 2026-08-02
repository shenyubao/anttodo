alter table public.subtasks
  add column due_at timestamptz,
  add column assignee_id uuid references auth.users(id) on delete set null;

create index subtasks_due_at_idx
  on public.subtasks(due_at)
  where due_at is not null;

create index subtasks_assignee_idx
  on public.subtasks(assignee_id)
  where assignee_id is not null;

create or replace function anttodo_private.validate_subtask_assignee()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, anttodo_private
as $$
begin
  if new.assignee_id is not null
    and not anttodo_private.can_user_view_task(new.task_id, new.assignee_id)
  then
    raise exception 'Subtask assignee must be able to view its parent task';
  end if;
  return new;
end;
$$;

create trigger subtasks_validate_assignee
before insert or update of assignee_id, task_id on public.subtasks
for each row execute function anttodo_private.validate_subtask_assignee();
