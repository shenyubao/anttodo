begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'space-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('c1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'space-member@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('c2000000-0000-4000-8000-000000000001', 'No system labels', 'c1000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'member');

insert into public.labels (
  id, workspace_id, parent_id, name, kind, view_scope, manage_scope,
  inherit_permissions, position, created_by
) values (
  'c3000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  null, '产品', 'team', 'all', 'users', false, 0,
  'c1000000-0000-4000-8000-000000000001'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'labels' and column_name = 'is_system'
  ),
  'labels.is_system is removed'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'labels' and column_name = 'owner_user_id'
  ),
  'labels.owner_user_id is removed'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'anttodo_private'
      and p.proname in (
        'ensure_user_space_label',
        'guard_system_label',
        'allow_system_label_write',
        'user_space_label_name'
      )
  ),
  'user-space system label functions are gone'
);
select ok(
  not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('labels', 'profiles', 'workspace_members')
      and not t.tgisinternal
      and tgname in (
        'labels_guard_system',
        'profiles_sync_user_space_label_name',
        'workspace_members_user_space_label'
      )
  ),
  'user-space system label triggers are gone'
);
select hasnt_table('public', 'user_sidebar_members', 'user sidebar member table is removed');
select is(
  (select count(*)::integer from public.labels where workspace_id = 'c2000000-0000-4000-8000-000000000001'),
  1,
  'joining a workspace does not create a member-named label'
);
select is(
  (select name from public.labels where workspace_id = 'c2000000-0000-4000-8000-000000000001'),
  '产品',
  'only the explicit user label remains'
);

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.list_label_task_counts('c2000000-0000-4000-8000-000000000001')),
  1,
  'label counts include the remaining user label'
);
select ok(
  not anttodo_private.can_view_task_list(
    'c2000000-0000-4000-8000-000000000001',
    'user:c1000000-0000-4000-8000-000000000002'
  ),
  'member-specific task lists cannot be viewed'
);
select ok(
  not anttodo_private.can_edit_task_list(
    'c2000000-0000-4000-8000-000000000001',
    'user:c1000000-0000-4000-8000-000000000002'
  ),
  'member-specific task lists cannot be edited'
);

reset role;
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'task_list_preferences_list_key_check') not like '%user:%',
  'task list preferences reject user-space keys'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'task_sections_list_key_check') not like '%user:%',
  'task sections reject user-space keys'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'task_list_placements_list_key_check') not like '%user:%',
  'task placements reject user-space keys'
);
select lives_ok(
  $$insert into public.task_list_preferences (user_id, workspace_id, list_key)
    values (
      'c1000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'assigned'
    )$$,
  'the assigned system view remains available'
);
select lives_ok(
  $$insert into public.labels (
    workspace_id, name, kind, view_scope, manage_scope, inherit_permissions, created_by
  ) values (
    'c2000000-0000-4000-8000-000000000001',
    '研发', 'team', 'all', 'users', false,
    'c1000000-0000-4000-8000-000000000001'
  )$$,
  'creating a normal label still works'
);

insert into public.labels (
  id, workspace_id, name, kind, view_scope, manage_scope,
  inherit_permissions, position, created_by
) values (
  'c3000000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000001',
  '玉宝', 'team', 'all', 'users', false, 2,
  'c1000000-0000-4000-8000-000000000001'
);

insert into public.tasks (
  id, workspace_id, title, created_by
) values (
  'c4000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  '普通同名标签任务',
  'c1000000-0000-4000-8000-000000000001'
);

insert into public.task_labels (task_id, label_id)
values (
  'c4000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000002'
);

select ok(
  exists (
    select 1 from public.labels
    where id = 'c3000000-0000-4000-8000-000000000002'
      and name = '玉宝'
  ),
  'a normal user-created label with a member name is preserved'
);

select ok(
  exists (
    select 1 from public.task_labels
    where task_id = 'c4000000-0000-4000-8000-000000000001'
      and label_id = 'c3000000-0000-4000-8000-000000000002'
  ),
  'task associations to normal labels are preserved'
);

select * from finish();
rollback;
