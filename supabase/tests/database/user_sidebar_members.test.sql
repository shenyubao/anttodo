begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sidebar-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('b1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sidebar-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('b1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sidebar-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('b2000000-0000-4000-8000-000000000001', 'User sidebar', 'b1000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role)
values ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'member');

select has_table('public', 'user_sidebar_members', 'user sidebar member table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.user_sidebar_members'::regclass), 'RLS is enabled');
select ok(has_table_privilege('authenticated', 'public.user_sidebar_members', 'SELECT'), 'authenticated can select');
select ok(has_table_privilege('authenticated', 'public.user_sidebar_members', 'INSERT'), 'authenticated can insert');
select ok(has_table_privilege('authenticated', 'public.user_sidebar_members', 'DELETE'), 'authenticated can delete');
select ok(not has_table_privilege('authenticated', 'public.user_sidebar_members', 'UPDATE'), 'authenticated cannot update');
select ok(
  not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_sidebar_members'::regclass
      and conname = 'user_sidebar_members_workspace_id_fkey'
  ),
  'sidebar members do not FK directly to workspaces'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$
  insert into public.user_sidebar_members (user_id, workspace_id, member_user_id)
  values (
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002'
  )
$$, 'owner can follow a workspace member');

select is((select count(*)::integer from public.user_sidebar_members), 1, 'owner sees only own followed users');

select throws_ok($$
  insert into public.user_sidebar_members (user_id, workspace_id, member_user_id)
  values (
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  )
$$, '42501', null, 'self is implicit and cannot be stored');

select throws_ok($$
  insert into public.user_sidebar_members (user_id, workspace_id, member_user_id)
  values (
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000003'
  )
$$, '23503', null, 'a non-member cannot be followed');

select throws_ok($$
  insert into public.user_sidebar_members (user_id, workspace_id, member_user_id)
  values (
    'b1000000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  )
$$, '42501', null, 'a user cannot write another user sidebar');

select ok(
  anttodo_private.can_view_task_list(
    'b2000000-0000-4000-8000-000000000001',
    'user:b1000000-0000-4000-8000-000000000002'
  ),
  'workspace member can view a member task list'
);
select ok(
  anttodo_private.can_edit_task_list(
    'b2000000-0000-4000-8000-000000000001',
    'user:b1000000-0000-4000-8000-000000000002'
  ),
  'workspace member can organize a member task list'
);
select ok(
  not anttodo_private.can_view_task_list(
    'b2000000-0000-4000-8000-000000000001',
    'user:not-a-uuid'
  ),
  'malformed user task list keys are rejected safely'
);

select lives_ok($$
  insert into public.task_list_preferences (user_id, workspace_id, list_key)
  values (
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'user:b1000000-0000-4000-8000-000000000002'
  )
$$, 'member task list preferences can be stored');

select lives_ok($$
  insert into public.task_sections (workspace_id, list_key, name, created_by)
  values (
    'b2000000-0000-4000-8000-000000000001',
    'user:b1000000-0000-4000-8000-000000000002',
    '稍后处理',
    'b1000000-0000-4000-8000-000000000001'
  )
$$, 'member task list sections can be stored');

select throws_ok($$
  insert into public.task_list_preferences (user_id, workspace_id, list_key)
  values (
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'user:not-a-uuid'
  )
$$, '42501', null, 'malformed user task list keys are rejected by RLS');

set local role postgres;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::integer from public.user_sidebar_members), 0, 'member cannot read owner sidebar rows');

select lives_ok($$
  insert into public.user_sidebar_members (user_id, workspace_id, member_user_id)
  values (
    'b1000000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  )
$$, 'member can follow the workspace owner');

select is((select count(*)::integer from public.user_sidebar_members), 1, 'member sees only own followed users');

select lives_ok($$
  delete from public.user_sidebar_members
  where workspace_id = 'b2000000-0000-4000-8000-000000000001'
    and member_user_id = 'b1000000-0000-4000-8000-000000000001'
$$, 'member can remove an own followed user');

set local role postgres;
select throws_ok($$
  insert into public.task_list_preferences (user_id, workspace_id, list_key)
  values (
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'user:not-a-uuid'
  )
$$, '23514', null, 'malformed user task list keys fail the table constraint');

delete from public.workspace_members
where workspace_id = 'b2000000-0000-4000-8000-000000000001'
  and user_id = 'b1000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.user_sidebar_members), 0, 'membership removal cascades sidebar rows');

select * from finish();
rollback;
