begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('14100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dep-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('14100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dep-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('14100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dep-viewer@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('24100000-0000-0000-0000-000000000001', 'Dependencies Test', '14100000-0000-0000-0000-000000000001');

insert into public.workspace_members(workspace_id, user_id, role) values
  ('24100000-0000-0000-0000-000000000001', '14100000-0000-0000-0000-000000000002', 'member'),
  ('24100000-0000-0000-0000-000000000001', '14100000-0000-0000-0000-000000000003', 'member');

insert into public.labels(
  id, workspace_id, name, kind, view_scope, manage_scope, inherit_permissions, created_by
) values (
  '34100000-0000-0000-0000-000000000001',
  '24100000-0000-0000-0000-000000000001',
  'Shared',
  'team',
  'users',
  'users',
  false,
  '14100000-0000-0000-0000-000000000001'
);

insert into public.label_user_acl(label_id, workspace_id, user_id, permission) values
  ('34100000-0000-0000-0000-000000000001', '24100000-0000-0000-0000-000000000001', '14100000-0000-0000-0000-000000000002', 'edit'),
  ('34100000-0000-0000-0000-000000000001', '24100000-0000-0000-0000-000000000001', '14100000-0000-0000-0000-000000000003', 'view');

insert into public.tasks(id, workspace_id, title, created_by) values
  ('44100000-0000-0000-0000-000000000001', '24100000-0000-0000-0000-000000000001', 'Successor', '14100000-0000-0000-0000-000000000001'),
  ('44100000-0000-0000-0000-000000000002', '24100000-0000-0000-0000-000000000001', 'Predecessor', '14100000-0000-0000-0000-000000000001'),
  ('44100000-0000-0000-0000-000000000003', '24100000-0000-0000-0000-000000000001', 'Third', '14100000-0000-0000-0000-000000000001');

insert into public.task_labels(task_id, label_id) values
  ('44100000-0000-0000-0000-000000000001', '34100000-0000-0000-0000-000000000001'),
  ('44100000-0000-0000-0000-000000000002', '34100000-0000-0000-0000-000000000001'),
  ('44100000-0000-0000-0000-000000000003', '34100000-0000-0000-0000-000000000001');

insert into public.tasks(id, workspace_id, parent_task_id, title, position, created_by) values
  ('54100000-0000-0000-0000-000000000001','24100000-0000-0000-0000-000000000001','44100000-0000-0000-0000-000000000001','Child of successor',0,'14100000-0000-0000-0000-000000000001'),
  ('54100000-0000-0000-0000-000000000002','24100000-0000-0000-0000-000000000001','44100000-0000-0000-0000-000000000002','Child of predecessor',0,'14100000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    insert into public.task_dependencies(id, workspace_id, task_id, depends_on_task_id)
    values (
      '64100000-0000-0000-0000-000000000001',
      '24100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000002'
    )
  $$,
  'editor can attach a predecessor task'
);

select is(
  (
    select created_by
    from public.task_dependencies
    where id = '64100000-0000-0000-0000-000000000001'
  ),
  '14100000-0000-0000-0000-000000000001'::uuid,
  'insert trigger fills created_by from auth.uid'
);

select throws_ok(
  $$
    insert into public.task_dependencies(workspace_id, task_id, depends_on_task_id)
    values (
      '24100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'A task cannot depend on itself',
  'self dependency is rejected'
);

select lives_ok(
  $$
    insert into public.task_dependencies(workspace_id, task_id, depends_on_task_id)
    values (
      '24100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000002',
      '44100000-0000-0000-0000-000000000003'
    )
  $$,
  'second edge in a chain is allowed'
);

select throws_ok(
  $$
    insert into public.task_dependencies(workspace_id, task_id, depends_on_task_id)
    values (
      '24100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000003',
      '44100000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'Task dependency cycle detected',
  'cyclic dependency is rejected'
);

select lives_ok(
  $$
    insert into public.task_dependencies(workspace_id, task_id, depends_on_task_id)
    values (
      '24100000-0000-0000-0000-000000000001',
      '54100000-0000-0000-0000-000000000001',
      '54100000-0000-0000-0000-000000000002'
    )
  $$,
  'a nested task can depend on another nested task'
);

select throws_ok(
  $$
    insert into public.task_dependencies(workspace_id, task_id, depends_on_task_id)
    values (
      '24100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000002'
    )
  $$,
  '23505'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is(
  (
    select count(*)::integer
    from public.task_dependencies
    where task_id = '44100000-0000-0000-0000-000000000001'
  ),
  1,
  'viewer can select dependencies on a viewable task'
);

select throws_ok(
  $$
    insert into public.task_dependencies(workspace_id, task_id, depends_on_task_id)
    values (
      '24100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000003'
    )
  $$,
  '42501'
);

select is(
  (
    select count(*)::integer
    from public.task_dependencies
    where id = '64100000-0000-0000-0000-000000000001'
  ),
  1,
  'viewer delete is a no-op under RLS'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$
    delete from public.task_dependencies
    where id = '64100000-0000-0000-0000-000000000001'
  $$,
  'editor can remove a dependency'
);

reset role;

select lives_ok(
  $$
    delete from public.tasks where id = '44100000-0000-0000-0000-000000000002'
  $$,
  'deleting a predecessor task is allowed'
);

select is(
  (
    select count(*)::integer
    from public.task_dependencies
    where depends_on_task_id = '44100000-0000-0000-0000-000000000002'
       or task_id = '44100000-0000-0000-0000-000000000002'
  ),
  0,
  'deleting a task cascades its dependency edges'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    insert into public.task_dependencies(workspace_id, task_id, depends_on_task_id)
    values (
      '24100000-0000-0000-0000-000000000001',
      '54100000-0000-0000-0000-000000000001',
      '44100000-0000-0000-0000-000000000003'
    )
  $$,
  'a nested task can depend on a root task'
);

select lives_ok(
  $$
    update public.tasks set deleted_at=now() where id='54100000-0000-0000-0000-000000000001';
    delete from public.tasks where id='54100000-0000-0000-0000-000000000001'
  $$,
  'deleting a nested successor task is allowed'
);

select is(
  (
    select count(*)::integer
    from public.task_dependencies
    where task_id = '54100000-0000-0000-0000-000000000001'
       or depends_on_task_id = '54100000-0000-0000-0000-000000000001'
  ),
  0,
  'deleting a nested task cascades its dependency edges'
);

select * from finish();
rollback;
