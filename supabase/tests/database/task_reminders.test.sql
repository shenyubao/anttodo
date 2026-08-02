begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('12000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reminder-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reminder-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reminder-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('22000000-0000-0000-0000-000000000001', 'Reminder Test', '12000000-0000-0000-0000-000000000001');
insert into public.workspace_members(workspace_id, user_id, role)
values ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'member');
insert into public.tasks(id, workspace_id, title, created_by)
values ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'Reminder task', '12000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.task_reminders(task_id, anchor, offset_value, offset_unit, trigger_at, position, created_by)
    values ('42000000-0000-0000-0000-000000000001', 'start', 5, 'minute', now(), 0, '12000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'authenticated clients cannot insert reminders directly'
);

select lives_ok(
  $$select public.save_task_schedule(
    '42000000-0000-0000-0000-000000000001',
    '2026-08-02 10:00:00+00', null, false, 'UTC',
    '[{"anchor":"start","offset_value":30,"offset_unit":"minute","local_time":null},
      {"anchor":"start","offset_value":1,"offset_unit":"hour","local_time":null}]'::jsonb,
    true
  )$$,
  'owner can atomically save a date and multiple reminders'
);
select is((select count(*)::integer from public.task_reminders), 2, 'RPC saves every selected reminder');
select is((select persistent from public.task_reminder_settings), true, 'RPC saves persistent mode');
select is(
  (select trigger_at from public.task_reminders where offset_unit = 'minute'),
  '2026-08-02 09:30:00+00'::timestamptz,
  'timed reminders are calculated relative to the start'
);

select throws_ok(
  $$select public.save_task_schedule(
    '42000000-0000-0000-0000-000000000001', '2026-08-02 10:00:00+00', null, false, 'UTC',
    '[{"anchor":"start","offset_value":366,"offset_unit":"day","local_time":null}]'::jsonb, false
  )$$,
  'A reminder cannot be more than 365 days early',
  'RPC rejects reminders more than one year early'
);
select is((select count(*)::integer from public.task_reminders), 2, 'failed RPC leaves the existing schedule unchanged');

update public.tasks set due_at = '2026-08-02 12:00:00+00'
where id = '42000000-0000-0000-0000-000000000001';
select is(
  (select trigger_at from public.task_reminders where offset_unit = 'minute'),
  '2026-08-02 11:30:00+00'::timestamptz,
  'changing the task date recalculates reminders'
);

reset role;
insert into public.reminder_delivery_states(
  reminder_id, scheduled_for, recipient_id, persistent, next_delivery_at,
  acknowledgement_token_hash
) select id, trigger_at, '12000000-0000-0000-0000-000000000001', true, trigger_at, repeat('a', 64)
from public.task_reminders limit 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.tasks set status = 'completed', completed_at = now()
where id = '42000000-0000-0000-0000-000000000001';
reset role;
select ok((select cancelled_at is not null from public.reminder_delivery_states), 'completing a task cancels its active delivery');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.tasks set status = 'open', completed_at = null where id = '42000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.save_task_schedule(
    '42000000-0000-0000-0000-000000000001',
    '2026-11-01 04:00:00+00', '2026-11-01 04:00:00+00', true, 'America/New_York',
    '[{"anchor":"start","offset_value":1,"offset_unit":"day","local_time":"09:00"}]'::jsonb, false
  )$$,
  'all-day local reminder saves across a DST boundary'
);
select is((select trigger_at from public.task_reminders), '2026-10-31 13:00:00+00'::timestamptz, 'all-day trigger uses the task time zone');

select lives_ok(
  $$select public.save_task_schedule(
    '42000000-0000-0000-0000-000000000001', null, null, false, null, '[]'::jsonb, false
  )$$,
  'clearing a date clears its schedule atomically'
);
select is((select count(*)::integer from public.task_reminders), 0, 'clearing a date deletes reminders');
select is((select count(*)::integer from public.task_reminder_settings), 0, 'clearing a date deletes persistent settings');

select set_config('request.jwt.claims', '{"sub":"12000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select public.save_task_schedule(
    '42000000-0000-0000-0000-000000000001', '2026-08-02 10:00:00+00', null, false, 'UTC', '[]'::jsonb, false
  )$$,
  '42501', null, 'outsiders cannot edit a task schedule'
);
select is((select count(*)::integer from public.task_reminders), 0, 'outsiders cannot see reminder rules');

select * from finish();
rollback;
