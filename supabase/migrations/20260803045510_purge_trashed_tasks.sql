create or replace function anttodo_private.purge_trashed_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.tasks
  where deleted_at is not null
    and deleted_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function anttodo_private.purge_trashed_tasks()
from public, anon, authenticated;
grant execute on function anttodo_private.purge_trashed_tasks() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'anttodo-purge-trashed-tasks') then
      perform cron.unschedule('anttodo-purge-trashed-tasks');
    end if;
    perform cron.schedule(
      'anttodo-purge-trashed-tasks',
      '0 3 * * *',
      'select anttodo_private.purge_trashed_tasks()'
    );
  end if;
end
$$;
