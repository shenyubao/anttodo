begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

select hasnt_table('public', 'client_devices', 'client devices are retired');
select hasnt_table('public', 'client_device_cursors', 'client cursors are retired');
select hasnt_table('public', 'client_sync_ticks', 'client sync ticks are retired');
select hasnt_table('public', 'client_sync_conflicts', 'client sync conflicts are retired');
select hasnt_table('anttodo_private', 'client_change_log', 'private client change log is retired');
select hasnt_table('anttodo_private', 'client_applied_operations', 'applied operation deduplication is retired');

select hasnt_function('public', 'register_client_device', array['uuid', 'text', 'text'], 'device registration RPC is retired');
select hasnt_function('public', 'get_client_sync_head', array['uuid'], 'sync head RPC is retired');
select hasnt_function('public', 'get_client_sync_manifest', array['uuid'], 'sync manifest RPC is retired');
select hasnt_function('public', 'pull_client_changes', array['uuid', 'bigint', 'integer'], 'change pull RPC is retired');
select hasnt_function('public', 'ack_client_cursor', array['uuid', 'uuid', 'bigint'], 'cursor acknowledgement RPC is retired');
select hasnt_function('public', 'apply_client_operations', array['jsonb'], 'outbox apply RPC is retired');

select hasnt_trigger('public', 'tasks', 'tasks_client_change_log', 'tasks no longer write the client change log');
select hasnt_trigger('public', 'labels', 'labels_client_change_log', 'labels no longer write the client change log');
select hasnt_trigger('public', 'task_comments', 'task_comments_client_change_log', 'comments no longer write the client change log');
select hasnt_trigger('public', 'task_list_placements', 'task_list_placements_client_change_log', 'placements no longer write the client change log');
select hasnt_function('anttodo_private', 'record_client_change', array[]::text[], 'change-log trigger function is retired');
select is(
  (select count(*)::integer from cron.job where jobname = 'client-change-log-retention'),
  0,
  'client change-log retention job is retired'
);

select has_table('public', 'sync_conflicts', 'connector sync conflicts remain available');
select has_table('public', 'attachment_cleanup_queue', 'attachment cleanup remains available');
select has_column('public', 'tasks', 'version', 'task versions remain available');
select has_trigger('public', 'tasks', 'tasks_normalize_completed_at', 'task completion normalization remains available');

select * from finish();
rollback;
