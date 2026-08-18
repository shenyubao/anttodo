-- Local-first operations update task status through apply_client_operations.
-- Keep the table invariant intact even when a sync payload omits or the RPC
-- does not project completed_at explicitly.
create or replace function anttodo_private.normalize_task_completed_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'completed'::public.task_status then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function anttodo_private.normalize_task_completed_at()
  from public, anon, authenticated;

drop trigger if exists tasks_normalize_completed_at on public.tasks;
create trigger tasks_normalize_completed_at
before insert or update of status, completed_at on public.tasks
for each row execute function anttodo_private.normalize_task_completed_at();
