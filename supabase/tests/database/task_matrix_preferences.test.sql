begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '1a000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'matrix-owner@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '1a000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'matrix-member@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '1a000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'matrix-outsider@example.com', '', now(), '{}', '{}', now(), now()
);

insert into public.workspaces (id, name, created_by)
values ('2a000000-0000-0000-0000-000000000001', '四象限测试空间', '1a000000-0000-0000-0000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role)
values ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002', 'member');

select has_table('public', 'task_matrix_quadrants', 'matrix preference table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.task_matrix_quadrants'::regclass), 'RLS is enabled');
select ok(has_table_privilege('authenticated', 'public.task_matrix_quadrants', 'SELECT'), 'authenticated can select');
select ok(has_table_privilege('authenticated', 'public.task_matrix_quadrants', 'INSERT'), 'authenticated can insert');
select ok(has_table_privilege('authenticated', 'public.task_matrix_quadrants', 'UPDATE'), 'authenticated can update');
select ok(not has_table_privilege('authenticated', 'public.task_matrix_quadrants', 'DELETE'), 'authenticated cannot delete');
select ok(anttodo_private.is_valid_task_matrix_definition('{"labels":"all","due":["today"],"priorities":["high"],"kinds":["todo"],"assignee":"all"}'::jsonb), 'valid definition accepted');
select ok(not anttodo_private.is_valid_task_matrix_definition('{"labels":[],"due":["someday"],"priorities":"all","kinds":"all","assignee":"all"}'::jsonb), 'invalid definition rejected');
select ok(not anttodo_private.is_valid_task_matrix_definition('{"labels":"all","due":"all","priorities":"all","kinds":"all"}'::jsonb), 'definition without assignee is rejected');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok($$
  insert into public.task_matrix_quadrants (
    user_id, workspace_id, quadrant_key, name, definition, grouping, sort, direction
  ) values (
    '1a000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-000000000001',
    'important_urgent', '第一象限',
    '{"labels":"all","due":["overdue","today","tomorrow"],"priorities":["high","medium"],"kinds":"all","assignee":"1a000000-0000-0000-0000-000000000001"}'::jsonb,
    'due', 'priority', 'desc'
  )
$$, 'owner can insert own preference');

select is((select count(*)::integer from public.task_matrix_quadrants), 1, 'owner sees own preference');

select lives_ok($$
  update public.task_matrix_quadrants set name = '重要且紧急'
  where quadrant_key = 'important_urgent'
$$, 'owner can update own preference');

select throws_ok($$
  insert into public.task_matrix_quadrants (user_id, workspace_id, quadrant_key, name, definition)
  values (
    '1a000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-000000000001',
    'invalid', '非法象限',
    '{"labels":"all","due":"all","priorities":"all","kinds":"all","assignee":"all"}'::jsonb
  )
$$, '23514', null, 'invalid quadrant key is rejected');

select throws_ok($$
  insert into public.task_matrix_quadrants (user_id, workspace_id, quadrant_key, name, definition)
  values (
    '1a000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-000000000001',
    'important_not_urgent', '非法规则',
    '{"labels":"all","due":["someday"],"priorities":"all","kinds":"all","assignee":"all"}'::jsonb
  )
$$, '23514', null, 'invalid rule values are rejected');

select throws_ok($$
  insert into public.task_matrix_quadrants (user_id, workspace_id, quadrant_key, name, definition)
  values (
    '1a000000-0000-0000-0000-000000000002',
    '2a000000-0000-0000-0000-000000000001',
    'important_not_urgent', '他人配置',
    '{"labels":"all","due":"all","priorities":"all","kinds":"all","assignee":"all"}'::jsonb
  )
$$, '42501', null, 'a user cannot insert another user preference');

select set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok($$
  insert into public.task_matrix_quadrants (user_id, workspace_id, quadrant_key, name, definition)
  values (
    '1a000000-0000-0000-0000-000000000002',
    '2a000000-0000-0000-0000-000000000001',
    'important_urgent', '成员配置',
    '{"labels":"all","due":"all","priorities":"all","kinds":"all","assignee":"all"}'::jsonb
  )
$$, 'member can insert own preference');

select is((select count(*)::integer from public.task_matrix_quadrants), 1, 'member only sees own preference');

select set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.task_matrix_quadrants), 0, 'outsider sees no preferences');

select throws_ok($$
  insert into public.task_matrix_quadrants (user_id, workspace_id, quadrant_key, name, definition)
  values (
    '1a000000-0000-0000-0000-000000000003',
    '2a000000-0000-0000-0000-000000000001',
    'not_important_urgent', '外部用户配置',
    '{"labels":"all","due":"all","priorities":"all","kinds":"all","assignee":"all"}'::jsonb
  )
$$, '42501', null, 'outsider cannot insert a preference');

reset role;
delete from public.workspace_members
where workspace_id = '2a000000-0000-0000-0000-000000000001'
  and user_id = '1a000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is((select count(*)::integer from public.task_matrix_quadrants), 0, 'former member loses read access');

select * from finish();
rollback;
