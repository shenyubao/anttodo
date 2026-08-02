begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('17000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-created-by-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('17000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-created-by-member@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('27000000-0000-0000-0000-000000000001', 'Subtask Created By', '17000000-0000-0000-0000-000000000001');
insert into public.workspace_members(workspace_id, user_id, role)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'member');
insert into public.tasks(id, workspace_id, title, created_by)
values ('47000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'Parent task', '17000000-0000-0000-0000-000000000001');

select has_column('public', 'subtasks', 'created_by', 'subtasks expose created_by');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.subtasks(id, task_id, title, position, created_by)
values (
  '57000000-0000-0000-0000-000000000001',
  '47000000-0000-0000-0000-000000000001',
  'Explicit creator',
  0,
  '17000000-0000-0000-0000-000000000001'
);
select is(
  (select created_by from public.subtasks where id = '57000000-0000-0000-0000-000000000001'),
  '17000000-0000-0000-0000-000000000001'::uuid,
  'inserting a subtask stores created_by'
);

insert into public.subtasks(id, task_id, title, position)
values (
  '57000000-0000-0000-0000-000000000002',
  '47000000-0000-0000-0000-000000000001',
  'Default creator',
  1
);
select is(
  (select created_by from public.subtasks where id = '57000000-0000-0000-0000-000000000002'),
  '17000000-0000-0000-0000-000000000001'::uuid,
  'created_by defaults to the authenticated user'
);

select throws_ok(
  $$insert into public.subtasks(id, task_id, title, position, created_by)
    values (
      '57000000-0000-0000-0000-000000000003',
      '47000000-0000-0000-0000-000000000001',
      'Spoofed creator',
      2,
      '17000000-0000-0000-0000-000000000002'
    )$$,
  '42501',
  null,
  'created_by must match the authenticated user'
);

select * from finish();
rollback;
