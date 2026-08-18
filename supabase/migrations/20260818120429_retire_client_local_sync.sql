-- AntTodo clients now use the Data API directly with optimistic React Query
-- updates. Retire the dedicated local-first synchronization protocol while
-- retaining task versioning, connector sync conflicts, and attachment cleanup.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'client-change-log-retention') then
    perform cron.unschedule('client-change-log-retention');
  end if;
end;
$$;

drop function if exists public.apply_client_operations(jsonb);
drop function if exists public.pull_client_changes(uuid, bigint, integer);
drop function if exists public.ack_client_cursor(uuid, uuid, bigint);
drop function if exists public.get_client_sync_manifest(uuid);
drop function if exists public.get_client_sync_head(uuid);
drop function if exists public.register_client_device(uuid, text, text);

drop trigger if exists tasks_client_change_log on public.tasks;
drop trigger if exists labels_client_change_log on public.labels;
drop trigger if exists task_comments_client_change_log on public.task_comments;
drop trigger if exists task_list_placements_client_change_log on public.task_list_placements;

drop function if exists anttodo_private.record_client_change();

drop table if exists public.client_device_cursors;
drop table if exists public.client_sync_conflicts;
drop table if exists public.client_devices;
drop table if exists public.client_sync_ticks;
drop table if exists anttodo_private.client_applied_operations;
drop table if exists anttodo_private.client_change_log;
