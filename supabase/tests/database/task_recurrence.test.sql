begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('12100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recurrence-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('12100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recurrence-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('22100000-0000-0000-0000-000000000001', 'Recurrence Test', '12100000-0000-0000-0000-000000000001');

insert into public.tasks(id, workspace_id, title, created_by)
values ('42100000-0000-0000-0000-000000000001', '22100000-0000-0000-0000-000000000001', 'Recurring task', '12100000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"12100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$select public.save_task_schedule(
    '42100000-0000-0000-0000-000000000001',
    null, null, false, null, '[]'::jsonb, false,
    '{"freq":"daily","interval":1,"mode":"due"}'::jsonb
  )$$,
  'A due date is required before recurrence can be saved',
  'RPC rejects recurrence without a due date'
);

select lives_ok(
  $$select public.save_task_schedule(
    '42100000-0000-0000-0000-000000000001',
    '2026-08-03 10:00:00+00', null, false, 'UTC',
    '[{"anchor":"start","offset_value":30,"offset_unit":"minute","local_time":null}]'::jsonb,
    false,
    '{"freq":"daily","interval":1,"mode":"due"}'::jsonb
  )$$,
  'owner can save due date, reminder, and daily recurrence together'
);

select is(
  (select recurrence->>'freq' from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  'daily',
  'RPC stores recurrence on the task'
);

select throws_ok(
  $$select public.save_task_schedule(
    '42100000-0000-0000-0000-000000000001',
    '2026-08-03 10:00:00+00', null, false, 'UTC', '[]'::jsonb, false,
    '{"freq":"hourly","interval":1,"mode":"due"}'::jsonb
  )$$,
  'Invalid recurrence rule',
  'RPC rejects unknown recurrence frequencies'
);

select is(
  (select recurrence->>'freq' from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  'daily',
  'failed recurrence validation leaves the previous rule unchanged'
);

update public.tasks
set status = 'completed', completed_at = now()
where id = '42100000-0000-0000-0000-000000000001';

select is(
  (select status::text from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  'open',
  'completing a recurring task keeps it open'
);
select is(
  (select completed_at is null from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  true,
  'completing a recurring task clears completed_at'
);
select is(
  (select due_at from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  '2026-08-04 10:00:00+00'::timestamptz,
  'completing a daily recurring task advances due_at by one day'
);
select is(
  (select trigger_at from public.task_reminders where task_id = '42100000-0000-0000-0000-000000000001'),
  '2026-08-04 09:30:00+00'::timestamptz,
  'rolling a recurring task recalculates reminder triggers'
);
select ok(
  (
    select exists(
      select 1 from public.activity_events
      where task_id = '42100000-0000-0000-0000-000000000001'
        and event_type = 'task.occurrence_completed'
    )
  ),
  'rolling writes an occurrence_completed activity event'
);

select lives_ok(
  $$select public.save_task_schedule(
    '42100000-0000-0000-0000-000000000001',
    '2026-01-31 15:00:00+00', '2026-01-30 15:00:00+00', false, 'UTC',
    '[]'::jsonb, false,
    '{"freq":"monthly","interval":1,"mode":"due"}'::jsonb
  )$$,
  'owner can save a monthly range recurrence'
);

update public.tasks
set status = 'completed', completed_at = now()
where id = '42100000-0000-0000-0000-000000000001';

select is(
  (select due_at from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  '2026-02-28 15:00:00+00'::timestamptz,
  'monthly recurrence clamps to the last day of shorter months'
);
select is(
  (select due_start_at from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  '2026-02-27 15:00:00+00'::timestamptz,
  'range start advances by the same delta as due_at'
);

select lives_ok(
  $$select public.save_task_schedule(
    '42100000-0000-0000-0000-000000000001',
    null, null, false, null, '[]'::jsonb, false, null
  )$$,
  'clearing a date clears recurrence'
);
select is(
  (select recurrence from public.tasks where id = '42100000-0000-0000-0000-000000000001'),
  null,
  'cleared schedules have null recurrence'
);

select set_config('request.jwt.claims', '{"sub":"12100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.save_task_schedule(
    '42100000-0000-0000-0000-000000000001',
    '2026-08-03 10:00:00+00', null, false, 'UTC', '[]'::jsonb, false,
    '{"freq":"weekly","interval":1,"mode":"due"}'::jsonb
  )$$,
  '42501', null, 'outsiders cannot save recurrence'
);

select * from finish();
rollback;
