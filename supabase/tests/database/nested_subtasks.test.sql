begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('14200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nested-subtask-owner@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('24200000-0000-0000-0000-000000000001', 'Nested Subtasks', '14200000-0000-0000-0000-000000000001');

insert into public.tasks(id, workspace_id, title, created_by) values
  ('44200000-0000-0000-0000-000000000001', '24200000-0000-0000-0000-000000000001', 'Parent', '14200000-0000-0000-0000-000000000001'),
  ('44200000-0000-0000-0000-000000000002', '24200000-0000-0000-0000-000000000001', 'Other', '14200000-0000-0000-0000-000000000001');

select has_column('public', 'subtasks', 'parent_subtask_id', 'subtasks expose parent_subtask_id');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14200000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.subtasks(id, task_id, title, position, created_by) values
  ('54200000-0000-0000-0000-000000000001', '44200000-0000-0000-0000-000000000001', 'L2', 0, '14200000-0000-0000-0000-000000000001'),
  ('54200000-0000-0000-0000-000000000099', '44200000-0000-0000-0000-000000000002', 'Other L2', 0, '14200000-0000-0000-0000-000000000001');

select lives_ok(
  $$
    insert into public.subtasks(id, task_id, parent_subtask_id, title, position, created_by)
    values (
      '54200000-0000-0000-0000-000000000002',
      '44200000-0000-0000-0000-000000000001',
      '54200000-0000-0000-0000-000000000001',
      'L3',
      0,
      '14200000-0000-0000-0000-000000000001'
    )
  $$,
  'can nest a subtask under another subtask on the same task'
);

insert into public.subtasks(id, task_id, parent_subtask_id, title, position, created_by) values
  ('54200000-0000-0000-0000-000000000003', '44200000-0000-0000-0000-000000000001', '54200000-0000-0000-0000-000000000002', 'L4', 0, '14200000-0000-0000-0000-000000000001'),
  ('54200000-0000-0000-0000-000000000004', '44200000-0000-0000-0000-000000000001', '54200000-0000-0000-0000-000000000003', 'L5', 0, '14200000-0000-0000-0000-000000000001');

select throws_ok(
  $$
    insert into public.subtasks(id, task_id, parent_subtask_id, title, position, created_by)
    values (
      '54200000-0000-0000-0000-000000000005',
      '44200000-0000-0000-0000-000000000001',
      '54200000-0000-0000-0000-000000000004',
      'L6',
      0,
      '14200000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'Subtask nesting cannot exceed 5 levels',
  'rejects a sixth nesting level'
);

select throws_ok(
  $$
    insert into public.subtasks(id, task_id, parent_subtask_id, title, position, created_by)
    values (
      '54200000-0000-0000-0000-000000000006',
      '44200000-0000-0000-0000-000000000001',
      '54200000-0000-0000-0000-000000000099',
      'Cross task',
      0,
      '14200000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'Parent subtask must belong to the same task',
  'rejects a parent on another task'
);

select throws_ok(
  $$
    update public.subtasks
    set parent_subtask_id = '54200000-0000-0000-0000-000000000002'
    where id = '54200000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'Subtask nesting cannot contain a cycle',
  'rejects a cycle when a parent points at a descendant'
);

delete from public.subtasks where id = '54200000-0000-0000-0000-000000000002';

select is(
  (
    select count(*)::integer
    from public.subtasks
    where id in (
      '54200000-0000-0000-0000-000000000002',
      '54200000-0000-0000-0000-000000000003',
      '54200000-0000-0000-0000-000000000004'
    )
  ),
  0,
  'deleting a parent subtask cascades to descendants'
);

select is(
  (select count(*)::integer from public.subtasks where id = '54200000-0000-0000-0000-000000000001'),
  1,
  'deleting a nested parent leaves the top-level sibling'
);

select * from finish();
rollback;
