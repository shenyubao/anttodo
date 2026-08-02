alter table public.subtasks
  add column created_by uuid references auth.users(id) on delete set null;

create index subtasks_created_by_idx
  on public.subtasks(created_by)
  where created_by is not null;

create or replace function anttodo_private.set_subtask_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists subtasks_set_created_by on public.subtasks;
create trigger subtasks_set_created_by
before insert on public.subtasks
for each row execute function anttodo_private.set_subtask_created_by();

drop policy if exists subtasks_insert on public.subtasks;
create policy subtasks_insert on public.subtasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.can_edit_task(task_id))
);
