begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '16200000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pomodoro-owner@example.com', '', now(), '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, created_by)
values (
  '26200000-0000-0000-0000-000000000001',
  'Pomodoro Test',
  '16200000-0000-0000-0000-000000000001'
);

insert into public.tasks(id, workspace_id, title, created_by)
values (
  '46200000-0000-0000-0000-000000000001',
  '26200000-0000-0000-0000-000000000001',
  'Pomodoro task',
  '16200000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"16200000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

insert into public.tasks(id, workspace_id, parent_task_id, title, position, created_by)
values (
  '56200000-0000-0000-0000-000000000001',
  '26200000-0000-0000-0000-000000000001',
  '46200000-0000-0000-0000-000000000001',
  'Pomodoro nested task',0,'16200000-0000-0000-0000-000000000001'
);

select has_column('public', 'tasks', 'estimate_pomodoros', 'tasks expose estimate pomodoros');
select has_column('public', 'tasks', 'actual_pomodoros', 'tasks expose actual pomodoros');
select has_column('public', 'tasks', 'parent_task_id', 'tasks expose nesting');
select has_column('public', 'tasks', 'position', 'tasks expose sibling position');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tasks'::regclass),
  'tasks keep RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tasks'::regclass),
  'nested tasks use task RLS'
);

update public.tasks
set estimate_pomodoros = 3,
    actual_pomodoros = 2
where id = '46200000-0000-0000-0000-000000000001';

update public.tasks
set estimate_pomodoros = 1,
    actual_pomodoros = 1
where id = '56200000-0000-0000-0000-000000000001';

select is(
  (select estimate_pomodoros from public.tasks where id = '46200000-0000-0000-0000-000000000001'),
  3,
  'task pomodoro counts can be updated'
);
select is(
  (select actual_pomodoros from public.tasks where id = '56200000-0000-0000-0000-000000000001'),
  1,
  'nested task pomodoro counts can be updated'
);

select throws_ok(
  $$update public.tasks set actual_pomodoros = -1 where id = '46200000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'task pomodoro counts cannot be negative'
);
select throws_ok(
  $$update public.tasks set estimate_pomodoros = -1 where id = '56200000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'nested task pomodoro counts cannot be negative'
);

select * from finish();
rollback;
