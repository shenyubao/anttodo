begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '16000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'focus-owner@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '16000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'focus-member@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '16000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'focus-outsider@example.com', '', now(), '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, created_by)
values (
  '26000000-0000-0000-0000-000000000001',
  'Focus Test',
  '16000000-0000-0000-0000-000000000001'
);

insert into public.workspace_members(workspace_id, user_id, role)
values (
  '26000000-0000-0000-0000-000000000001',
  '16000000-0000-0000-0000-000000000002',
  'member'
);

insert into public.tasks(id, workspace_id, title, description, created_by)
values (
  '46000000-0000-0000-0000-000000000001',
  '26000000-0000-0000-0000-000000000001',
  'Focus task',
  'Task for focus',
  '16000000-0000-0000-0000-000000000001'
);

select has_table('public', 'focus_sessions', 'focus_sessions table exists');
select has_table('public', 'user_focus_settings', 'user_focus_settings table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.focus_sessions'::regclass),
  'focus_sessions enables RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_focus_settings'::regclass),
  'user_focus_settings enables RLS'
);
select ok(has_table_privilege('authenticated', 'public.focus_sessions', 'SELECT'), 'authenticated can select sessions');
select ok(has_table_privilege('authenticated', 'public.focus_sessions', 'INSERT'), 'authenticated can insert sessions');
select ok(has_table_privilege('authenticated', 'public.user_focus_settings', 'SELECT'), 'authenticated can select settings');
select ok(has_table_privilege('authenticated', 'public.user_focus_settings', 'UPDATE'), 'authenticated can update settings');
select ok(not has_table_privilege('anon', 'public.focus_sessions', 'SELECT'), 'anon cannot read sessions');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.user_focus_settings(user_id, workspace_id, pomodoro_minutes)
    values (
      '16000000-0000-0000-0000-000000000001',
      '26000000-0000-0000-0000-000000000001',
      30
    )
  $$,
  'owner can upsert focus settings'
);

select lives_ok(
  $$
    insert into public.focus_sessions(
      user_id, workspace_id, task_id, mode, kind,
      planned_seconds, elapsed_seconds, notes, started_at, ended_at
    ) values (
      '16000000-0000-0000-0000-000000000001',
      '26000000-0000-0000-0000-000000000001',
      '46000000-0000-0000-0000-000000000001',
      'pomodoro',
      'focus',
      1500,
      1500,
      'done',
      now() - interval '25 minutes',
      now()
    )
  $$,
  'owner can insert a focus session with a visible task'
);

select lives_ok(
  $$
    insert into public.focus_sessions(
      user_id, workspace_id, task_id, mode, kind,
      planned_seconds, elapsed_seconds, started_at, ended_at
    ) values (
      '16000000-0000-0000-0000-000000000001',
      '26000000-0000-0000-0000-000000000001',
      null,
      'stopwatch',
      'focus',
      0,
      600,
      now() - interval '10 minutes',
      now()
    )
  $$,
  'owner can insert a focus session without a task'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is_empty(
  $$
    select 1 from public.focus_sessions
    where user_id = '16000000-0000-0000-0000-000000000001'
  $$,
  'member cannot read another user focus sessions'
);

select throws_ok(
  $$
    insert into public.focus_sessions(
      user_id, workspace_id, mode, kind,
      planned_seconds, elapsed_seconds, started_at, ended_at
    ) values (
      '16000000-0000-0000-0000-000000000001',
      '26000000-0000-0000-0000-000000000001',
      'pomodoro',
      'focus',
      1500,
      1500,
      now() - interval '25 minutes',
      now()
    )
  $$,
  '42501',
  null,
  'member cannot insert a session for another user'
);

select lives_ok(
  $$
    insert into public.focus_sessions(
      user_id, workspace_id, mode, kind,
      planned_seconds, elapsed_seconds, started_at, ended_at
    ) values (
      '16000000-0000-0000-0000-000000000002',
      '26000000-0000-0000-0000-000000000001',
      'pomodoro',
      'focus',
      1500,
      1500,
      now() - interval '25 minutes',
      now()
    )
  $$,
  'member can insert their own focus session'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    insert into public.focus_sessions(
      user_id, workspace_id, mode, kind,
      planned_seconds, elapsed_seconds, started_at, ended_at
    ) values (
      '16000000-0000-0000-0000-000000000003',
      '26000000-0000-0000-0000-000000000001',
      'pomodoro',
      'focus',
      1500,
      1500,
      now() - interval '25 minutes',
      now()
    )
  $$,
  '42501',
  null,
  'outsider cannot insert focus sessions'
);

select throws_ok(
  $$
    insert into public.user_focus_settings(user_id, workspace_id)
    values (
      '16000000-0000-0000-0000-000000000003',
      '26000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  null,
  'outsider cannot insert focus settings'
);

select * from finish();
rollback;
