begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('13000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'activity-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('13000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'activity-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('23000000-0000-0000-0000-000000000001', 'Activity Test', '13000000-0000-0000-0000-000000000001');
insert into public.labels(id, workspace_id, name, kind, view_scope, manage_scope, inherit_permissions, created_by)
values ('33000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Activity label', 'team', 'all', 'all', false, '13000000-0000-0000-0000-000000000001');
insert into public.tasks(id, workspace_id, title, created_by)
values ('43000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Activity task', '13000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

update public.tasks set title = 'Renamed task', priority = 'high'
where id = '43000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.updated'),
  1,
  'one task update produces one activity event'
);
select is(
  (select payload->'changes'->'title'->>'before' from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.updated'),
  'Activity task',
  'task activity stores the previous field value'
);
select is(
  (select actor_id from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.updated'),
  '13000000-0000-0000-0000-000000000001'::uuid,
  'task activity stores the authenticated actor'
);

update public.tasks set title = 'Renamed task'
where id = '43000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.updated'),
  1,
  'a no-op update does not add activity'
);

insert into public.task_labels(task_id, label_id)
values ('43000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001');
select is(
  (select payload->>'label_name' from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.label_added'),
  'Activity label',
  'label activity stores a display snapshot'
);

insert into public.subtasks(id, task_id, title, completed, position)
values ('53000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', 'Child task', false, 0);
update public.subtasks set completed = true where id = '53000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.subtask_created'),
  1,
  'creating a subtask records activity'
);
select is(
  (select payload->'changes'->'completed'->>'after' from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.subtask_updated'),
  'true',
  'completing a subtask records its new state'
);
update public.subtasks
set due_at = '2026-08-09 10:00:00+00', assignee_id = '13000000-0000-0000-0000-000000000001'
where id = '53000000-0000-0000-0000-000000000001';
select is(
  (select payload->'changes'->'due_at'->>'after' from public.activity_events
   where task_id = '43000000-0000-0000-0000-000000000001'
     and event_type = 'task.subtask_updated'
     and payload->'changes' ? 'due_at'
   order by created_at desc, id desc limit 1),
  '2026-08-09T10:00:00+00:00',
  'changing a subtask date records its new value'
);
select is(
  (select payload->'changes'->'assignee_id'->>'after' from public.activity_events
   where task_id = '43000000-0000-0000-0000-000000000001'
     and event_type = 'task.subtask_updated'
     and payload->'changes' ? 'assignee_id'
   order by created_at desc, id desc limit 1),
  '13000000-0000-0000-0000-000000000001',
  'changing a subtask assignee records its new value'
);

select lives_ok(
  $$select public.save_task_schedule(
    '43000000-0000-0000-0000-000000000001',
    '2026-08-10 10:00:00+00', null, false, 'UTC',
    '[{"anchor":"start","offset_value":30,"offset_unit":"minute","local_time":null}]'::jsonb,
    true
  )$$,
  'saving a schedule with reminders succeeds'
);
select is(
  (select count(*)::integer from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.reminders_changed'),
  1,
  'one schedule save produces one reminder activity event'
);
select lives_ok(
  $$select public.save_task_schedule(
    '43000000-0000-0000-0000-000000000001',
    '2026-08-10 10:00:00+00', null, false, 'UTC',
    '[{"anchor":"start","offset_value":30,"offset_unit":"minute","local_time":null}]'::jsonb,
    true
  )$$,
  'saving an unchanged schedule succeeds'
);
select is(
  (select count(*)::integer from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' and event_type = 'task.reminders_changed'),
  1,
  'saving an unchanged schedule does not add reminder activity'
);
select is(
  (select count(*)::integer from public.list_task_activity('43000000-0000-0000-0000-000000000001', null, null, 3)),
  3,
  'activity RPC honors its page limit'
);
select is(
  (select count(*)::integer from public.list_task_activity(
    '43000000-0000-0000-0000-000000000001',
    (select created_at from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' order by created_at desc, id desc limit 1),
    (select id from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001' order by created_at desc, id desc limit 1),
    100
  )),
  (select count(*)::integer - 1 from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001'),
  'activity RPC cursor excludes the cursor event without skipping older rows'
);

select set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.list_task_activity('43000000-0000-0000-0000-000000000001', null, null, 50)),
  0,
  'outsiders cannot read task activity'
);
select is(
  (select count(*)::integer from public.activity_events where task_id = '43000000-0000-0000-0000-000000000001'),
  0,
  'activity table RLS also hides the task from outsiders'
);

select * from finish();
rollback;
