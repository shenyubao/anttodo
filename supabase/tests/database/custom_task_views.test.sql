begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '17000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'view-one@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '17000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'view-two@example.com', '', now(), '{}', '{}', now(), now()
);

insert into public.workspaces (id, name, created_by)
values ('27000000-0000-0000-0000-000000000001', '视图测试空间', '17000000-0000-0000-0000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'member');

select has_table('public', 'custom_task_views', 'custom task views table exists');
select has_table('public', 'task_system_view_preferences', 'system view preference table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.custom_task_views'::regclass));
select ok((select relrowsecurity from pg_class where oid = 'public.task_system_view_preferences'::regclass));
select ok(has_table_privilege('authenticated', 'public.custom_task_views', 'SELECT'));
select ok(has_table_privilege('authenticated', 'public.custom_task_views', 'INSERT'));
select ok(has_table_privilege('authenticated', 'public.custom_task_views', 'DELETE'));

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok($$
  insert into public.custom_task_views (id, workspace_id, user_id, name, definition, position)
  values (
    '00000000-0000-0000-0000-000000000001',
    '27000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0000-000000000001',
    '我的视图',
    '{"scope":"all","label_ids":[],"filter_assignee":"all","filter_assignee_ids":[],"filter_watching":"all","filter_creator":"all","filter_due":"all"}'::jsonb,
    1
  )
$$, 'a member can create a personal custom view');

select is((select count(*)::integer from public.custom_task_views), 1, 'a user only sees their own custom view');

select lives_ok($$
  insert into public.task_list_preferences (user_id, workspace_id, list_key, grouping, sort, direction)
  values (
    '17000000-0000-0000-0000-000000000001',
    '27000000-0000-0000-0000-000000000001',
    'custom:00000000-0000-0000-0000-000000000001',
    'none', 'custom', 'asc'
  )
$$, 'a custom view can persist its display preference');

select throws_ok($$
  insert into public.custom_task_views (workspace_id, user_id, name)
  values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', '他人的视图')
$$, '42501', null, 'a user cannot create another user custom view');

select lives_ok($$
  insert into public.task_system_view_preferences (user_id, workspace_id, view_key, visible, position)
  values ('17000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'today', false, 0)
$$, 'a user can hide a configurable system view');

select is((select visible from public.task_system_view_preferences where view_key = 'today'), false, 'system view visibility persists');

select lives_ok($$
  insert into public.task_system_view_preferences (user_id, workspace_id, view_key, visible, position)
  values ('17000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'all', false, 2)
$$, 'the all view can be hidden');

select lives_ok($$
  insert into public.task_system_view_preferences (user_id, workspace_id, view_key, visible, position)
  values ('17000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'inbox', false, 1)
$$, 'the inbox view can be hidden');

select lives_ok($$
  insert into public.task_system_view_preferences (user_id, workspace_id, view_key, visible, position)
  values ('17000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'trash', false, 3)
$$, 'the trash view can be hidden');

select lives_ok($$
  update public.task_system_view_preferences
  set position = case view_key
    when 'today' then 3
    when 'all' then 0
    when 'inbox' then 1
    when 'trash' then 2
  end
  where user_id = '17000000-0000-0000-0000-000000000001'
$$, 'a user can reorder system views');

select is(
  (
    select array_agg(view_key order by position)
    from public.task_system_view_preferences
    where user_id = '17000000-0000-0000-0000-000000000001'
  ),
  array['all', 'inbox', 'trash', 'today']::text[],
  'system view positions persist in order'
);

select lives_ok($$
  update public.custom_task_views set visible = false, position = 0
  where user_id = '17000000-0000-0000-0000-000000000001'
$$, 'a user can hide and reorder their custom view');

select lives_ok($$
  delete from public.custom_task_views
  where user_id = '17000000-0000-0000-0000-000000000001'
$$, 'a user can delete their custom view');

select is((select count(*)::integer from public.task_list_preferences where list_key like 'custom:%'), 0, 'deleting a custom view cleans its layout preference');

select * from finish();
rollback;
