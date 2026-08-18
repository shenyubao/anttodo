\set ON_ERROR_STOP on

do $$
begin
  if (select count(*) from public.tasks where id in (
    '4a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002'
  )) <> 3 then raise exception 'task row count mismatch'; end if;
  if (select parent_task_id from public.tasks where id='5a000000-0000-0000-0000-000000000001')
    <> '4a000000-0000-0000-0000-000000000001' then raise exception 'L2 parent mismatch'; end if;
  if (select parent_task_id from public.tasks where id='5a000000-0000-0000-0000-000000000002')
    <> '5a000000-0000-0000-0000-000000000001' then raise exception 'L3 parent mismatch'; end if;
  if (select status from public.tasks where id='5a000000-0000-0000-0000-000000000002') <> 'completed'
    then raise exception 'completion status mismatch'; end if;
  if (select completed_at from public.tasks where id='5a000000-0000-0000-0000-000000000002')
    <> '2026-08-12T00:00:00Z' then raise exception 'completion timestamp mismatch'; end if;
  if (select version from public.tasks where id='5a000000-0000-0000-0000-000000000002') <> 12
    then raise exception 'version mismatch'; end if;
  if (select task_id from public.task_comments where body='Nested comment')
    <> '5a000000-0000-0000-0000-000000000002' then raise exception 'comment scope mismatch'; end if;
  if (select task_id from public.focus_sessions where planned_seconds=1500)
    <> '5a000000-0000-0000-0000-000000000002' then raise exception 'focus scope mismatch'; end if;
  if not exists(select 1 from public.task_reminders where task_id='5a000000-0000-0000-0000-000000000002')
    then raise exception 'reminder scope mismatch'; end if;
  if not exists(select 1 from public.task_reminder_settings where task_id='5a000000-0000-0000-0000-000000000002' and persistent)
    then raise exception 'reminder setting mismatch'; end if;
  if not exists(select 1 from public.task_dependencies where task_id='5a000000-0000-0000-0000-000000000002'
    and depends_on_task_id='5a000000-0000-0000-0000-000000000001') then raise exception 'dependency scope mismatch'; end if;
  if not exists(select 1 from public.activity_events where task_id='5a000000-0000-0000-0000-000000000002'
    and event_type='task.updated' and payload #>> '{changes,status,after}'='completed') then raise exception 'activity migration mismatch'; end if;
  if not exists(select 1 from anttodo_private.task_attachment_bindings
    where bucket_id='task-attachments' and task_id='5a000000-0000-0000-0000-000000000002')
    then raise exception 'attachment binding mismatch'; end if;
  if exists(select 1 from information_schema.tables where table_schema='public' and table_name='subtasks')
    then raise exception 'legacy table remains'; end if;
end $$;

select 'unify_task_tree migration fixture passed' as result;
