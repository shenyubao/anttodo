begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('14000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-schedule-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('14000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-schedule-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('24000000-0000-0000-0000-000000000001', 'Subtask Schedule Test', '14000000-0000-0000-0000-000000000001');
insert into public.tasks(id, workspace_id, title, created_by)
values ('44000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', 'Parent', '14000000-0000-0000-0000-000000000001');
insert into public.subtasks(id, task_id, title, position, created_by)
values ('54000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001', 'Child', 0, '14000000-0000-0000-0000-000000000001');

select throws_ok(
  $$update public.subtasks
    set due_start_at = '2026-08-14 16:00:00+08', due_at = '2026-08-14 15:00:00+08'
    where id = '54000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'subtask time range must end after it starts'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$select public.save_subtask_schedule(
    '54000000-0000-0000-0000-000000000001',
    '2026-08-14 11:00:00+00',
    '2026-08-14 10:00:00+00',
    false,
    'UTC',
    '[{"anchor":"start","offset_value":30,"offset_unit":"minute","local_time":null}]'::jsonb,
    true
  )$$,
  'owner can save a subtask range and reminder'
);

select is(
  (select due_start_at from public.subtasks where id = '54000000-0000-0000-0000-000000000001'),
  '2026-08-14 10:00:00+00'::timestamptz,
  'subtask start is stored'
);
select is((select count(*)::integer from public.task_reminders where subtask_id = '54000000-0000-0000-0000-000000000001'), 1, 'subtask reminder is saved');
select is((select persistent from public.subtask_reminder_settings), true, 'subtask persistent reminder is saved');
select is(
  (select trigger_at from public.task_reminders where subtask_id = '54000000-0000-0000-0000-000000000001'),
  '2026-08-14 09:30:00+00'::timestamptz,
  'subtask reminder is calculated from the start'
);

select lives_ok(
  $$select public.save_task_schedule(
    '44000000-0000-0000-0000-000000000001',
    '2026-08-15 10:00:00+00', null, false, 'UTC',
    '[{"anchor":"start","offset_value":15,"offset_unit":"minute","local_time":null}]'::jsonb,
    false
  )$$,
  'parent schedule can be saved independently'
);
select is(
  (select count(*)::integer from public.task_reminders where task_id = '44000000-0000-0000-0000-000000000001' and subtask_id is null),
  1,
  'parent reminder is stored without a subtask_id'
);
select is(
  (select count(*)::integer from public.task_reminders where subtask_id = '54000000-0000-0000-0000-000000000001'),
  1,
  'saving the parent schedule does not delete subtask reminders'
);

reset role;
insert into public.reminder_delivery_states(
  reminder_id, scheduled_for, recipient_id, persistent, next_delivery_at,
  acknowledgement_token_hash
) select id, trigger_at, '14000000-0000-0000-0000-000000000001', true, trigger_at, repeat('b', 64)
from public.task_reminders where subtask_id = '54000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.subtasks set completed = true where id = '54000000-0000-0000-0000-000000000001';
reset role;
select ok(
  (select cancelled_at is not null from public.reminder_delivery_states),
  'completing a subtask cancels its active delivery'
);
select is(
  (select count(*)::integer from public.task_reminders where subtask_id = '54000000-0000-0000-0000-000000000001'),
  1,
  'completing a subtask keeps reminder rows for dispatch to skip'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.save_subtask_schedule(
    '54000000-0000-0000-0000-000000000001',
    '2026-08-16 10:00:00+00', null, false, 'UTC', '[]'::jsonb, false
  )$$,
  '42501',
  null,
  'outsiders cannot edit a subtask schedule'
);

select * from finish();
rollback;
