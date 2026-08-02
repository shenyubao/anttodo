begin;

create extension if not exists pgtap with schema extensions;

select plan(137);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'member@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '10000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'outsider@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '10000000-0000-0000-0000-000000000008',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'restricted-member@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into auth.users (
  id, instance_id, aud, role, phone, encrypted_password,
  phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '10000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', '+8613800138000', '',
  now(), '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
);

select is(
  (
    select display_name
    from public.profiles
    where id = '10000000-0000-0000-0000-000000000004'
  ),
  '138****8000',
  'phone-only auth users receive a masked phone profile name'
);

insert into public.workspaces (id, name, created_by)
values (
  '20000000-0000-0000-0000-000000000001',
  'RLS Test Workspace',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.workspace_members (workspace_id, user_id, role)
values
(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'member'
),
(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000008',
  'member'
);

insert into public.labels (
  id, workspace_id, parent_id, name, kind, view_scope, manage_scope,
  inherit_permissions, created_by
) values
(
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  null,
  'Team', 'team', 'all', 'users', false,
  '10000000-0000-0000-0000-000000000001'
),
(
  '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  null,
  'Restricted', 'team', 'users', 'users', false,
  '10000000-0000-0000-0000-000000000001'
),
(
  '30000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Team child', 'team', 'all', 'users', true,
  '10000000-0000-0000-0000-000000000001'
),
(
  '30000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000004',
  'Team grandchild', 'team', 'all', 'users', true,
  '10000000-0000-0000-0000-000000000001'
);

insert into public.label_user_acl (label_id, workspace_id, user_id, permission)
values (
  '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'view'
);

insert into public.tasks (
  id, workspace_id, title, created_by
) values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Strict intersection task',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.task_labels (task_id, label_id) values
(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001'
),
(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002'
);

select is(
  (
    select public
    from storage.buckets
    where id = 'task-attachments'
  ),
  false,
  'task attachment bucket is private'
);
select is(
  (
    select file_size_limit
    from storage.buckets
    where id = 'task-attachments'
  ),
  20971520::bigint,
  'task attachment bucket enforces a 20MB limit'
);
select ok(
  not exists (
    select 1
    from storage.buckets
    where id = 'task-attachments'
      and 'image/svg+xml' = any(allowed_mime_types)
  ),
  'task attachment bucket rejects SVG uploads'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'task_attachments_select'
      and cmd = 'SELECT'
      and roles = array['authenticated'::name]
  ),
  1,
  'task attachments define an authenticated read policy'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'task_attachments_insert'
      and cmd = 'INSERT'
      and roles = array['authenticated'::name]
  ),
  1,
  'task attachments define an authenticated upload policy'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'task_attachments_delete'
      and cmd = 'DELETE'
      and roles = array['authenticated'::name]
  ),
  1,
  'task attachments define an authenticated delete policy'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'task_attachments_%'
      and cmd = 'UPDATE'
  ),
  0,
  'task attachment objects cannot be overwritten'
);


set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);


select is(
  anttodo_private.label_permission_level('30000000-0000-0000-0000-000000000002'),
  2,
  'workspace owner can edit restricted labels'
);
select ok(
  anttodo_private.can_edit_task('40000000-0000-0000-0000-000000000001'),
  'workspace owner can edit a multi-label task'
);
select is((select count(*)::integer from public.tasks), 1, 'owner can read the task');
select lives_ok(
  $$
    insert into public.workspaces (id, name, created_by)
    values (
      '20000000-0000-0000-0000-000000000002',
      'Created through Data API',
      '10000000-0000-0000-0000-000000000001'
    )
    returning id
  $$,
  'workspace creator can receive the inserted row'
);
select is(
  (
    select count(*)::integer
    from public.workspace_members
    where workspace_id = '20000000-0000-0000-0000-000000000002'
      and user_id = '10000000-0000-0000-0000-000000000001'
      and role = 'owner'
  ),
  1,
  'workspace creation adds the creator as owner'
);
select is(
  (
    select count(*)::integer
    from public.labels
    where workspace_id = '20000000-0000-0000-0000-000000000002'
  ),
  0,
  'workspace creation does not add an inbox label'
);
select ok(
  (
    select slug
    from public.workspaces
    where id = '20000000-0000-0000-0000-000000000002'
  ) is not null,
  'workspace creation without slug receives an auto-generated slug'
);
select throws_ok(
  $$
    insert into public.workspaces (id, name, slug, created_by)
    values (
      '20000000-0000-0000-0000-000000000003',
      'Duplicate slug workspace',
      (select slug from public.workspaces where id = '20000000-0000-0000-0000-000000000002'),
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '23505',
  null,
  'workspace slug must be unique'
);
select ok(
  public.is_workspace_slug_available('brand-new-team-slug'),
  'unused workspace slug is available'
);
select ok(
  not public.is_workspace_slug_available(
    (select slug from public.workspaces where id = '20000000-0000-0000-0000-000000000002'),
    '20000000-0000-0000-0000-000000000003'
  ),
  'existing workspace slug is unavailable to another workspace'
);
select lives_ok(
  $$
    insert into public.labels (
      id, workspace_id, name, inherit_permissions, created_by
    ) values (
      '30000000-0000-0000-0000-000000000003',
      '20000000-0000-0000-0000-000000000001',
      'Created through Data API',
      false,
      '10000000-0000-0000-0000-000000000001'
    )
    returning id
  $$,
  'label creator can receive the inserted row'
);
select lives_ok(
  $$
    select public.create_task_with_labels(
      '20000000-0000-0000-0000-000000000001',
      'Created through RPC',
      array['30000000-0000-0000-0000-000000000001'::uuid]
    )
  $$,
  'task RPC can bootstrap the first task label under RLS'
);
select is(
  (
    select count(*)::integer
    from public.task_labels tl
    join public.tasks t on t.id = tl.task_id
    where t.title = 'Created through RPC'
      and tl.label_id = '30000000-0000-0000-0000-000000000001'
  ),
  1,
  'task RPC attaches the requested label'
);
select is(
  (
    select kind
    from public.tasks
    where title = 'Created through RPC'
  ),
  'todo'::public.task_kind,
  'task RPC keeps existing callers backward compatible as todos'
);
select lives_ok(
  $$
    select public.create_task_with_labels(
      p_workspace_id => '20000000-0000-0000-0000-000000000001',
      p_title => 'Created note',
      p_label_ids => array[]::uuid[],
      p_priority => 'high',
      p_kind => 'note'
    )
  $$,
  'task RPC creates a note'
);
select is(
  (
    select kind
    from public.tasks
    where title = 'Created note'
  ),
  'note'::public.task_kind,
  'created note stores its item kind'
);
select is(
  (
    select priority
    from public.tasks
    where title = 'Created note'
  ),
  'none'::public.task_priority,
  'created notes cannot receive a quick-add priority'
);
select lives_ok(
  $$
    update public.tasks
    set kind = 'note'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  'task editors can switch an item to a note'
);
select is(
  (
    select kind
    from public.tasks
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  'note'::public.task_kind,
  'authorized type updates are stored'
);
select lives_ok(
  $$
    select public.create_task_with_labels(
      '20000000-0000-0000-0000-000000000001',
      'Created in inbox',
      array[]::uuid[]
    )
  $$,
  'task RPC accepts an unlabeled inbox task'
);
select is(
  (
    select count(*)::integer
    from public.task_labels tl
    join public.tasks t on t.id = tl.task_id
    where t.title = 'Created in inbox'
  ),
  0,
  'inbox task has no task-label rows'
);
select is(
  (
    select count(*)::integer
    from public.activity_events ae
    join public.tasks t on t.id = ae.task_id
    where t.title = 'Created through RPC'
      and ae.event_type = 'task.created'
  ),
  1,
  'task RPC records the creation activity'
);
select is(
  (
    select due_is_all_day
    from public.tasks
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  false,
  'new due range fields keep a backward-compatible default'
);
select lives_ok(
  $$
    update public.tasks
    set
      due_start_at = '2026-07-25 14:30:00+08',
      due_at = '2026-07-25 15:30:00+08'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  'task editor can save a valid due range under the existing RLS policy'
);
select is(
  (
    select due_start_at < due_at
    from public.tasks
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  true,
  'valid due range preserves start and end ordering'
);
select throws_ok(
  $$
    update public.tasks
    set
      due_start_at = '2026-07-25 16:00:00+08',
      due_at = '2026-07-25 15:30:00+08'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  null,
  'database rejects a due range whose end precedes its start'
);
select is(
  anttodo_private.attachment_workspace_id(
    '20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-4000-8000-000000000001.png'
  ),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'attachment path resolves its workspace'
);
select is(
  anttodo_private.attachment_task_id(
    '20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-4000-8000-000000000001.png'
  ),
  '40000000-0000-0000-0000-000000000001'::uuid,
  'attachment path resolves its task'
);
select is(
  anttodo_private.attachment_task_id(
    '20000000-0000-0000-0000-000000000099/not-a-task/50000000-0000-4000-8000-000000000003.png'
  ),
  null::uuid,
  'attachment path rejects a forged task identifier'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_date_time_preferences'
      and roles = array['authenticated'::name]
  ),
  3,
  'date and time preferences define self-only select, insert, and update policies'
);
select lives_ok(
  $$
    insert into public.user_date_time_preferences (user_id)
    values ('10000000-0000-0000-0000-000000000001')
  $$,
  'a user can create their own date and time preferences'
);
select is(
  (
    select jsonb_build_object(
      'time', time_format,
      'date', date_format,
      'week', week_starts_on,
      'lunar', show_lunar,
      'weekNumbers', show_week_numbers,
      'holidays', show_holiday_adjustments,
      'timeZone', time_zone_enabled
    )
    from public.user_date_time_preferences
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  '{"time":"24h","date":"ymd","week":1,"lunar":false,"weekNumbers":true,"holidays":true,"timeZone":false}'::jsonb,
  'date and time preferences use the reference defaults'
);
select lives_ok(
  $$
    update public.tasks
    set due_timezone = 'America/New_York'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  'task editors can save an IANA time zone under the existing task RLS policy'
);
select is(
  (
    select due_timezone
    from public.tasks
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  'America/New_York',
  'the task time zone is stored alongside its UTC due time'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (
    select count(*)::integer
    from public.user_date_time_preferences
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  0,
  'another authenticated user cannot read date and time preferences'
);
select is(
  anttodo_private.label_permission_level('30000000-0000-0000-0000-000000000001'),
  1,
  'member gets view access to workspace-visible labels'
);
select is(
  anttodo_private.label_permission_level('30000000-0000-0000-0000-000000000002'),
  1,
  'explicit ACL grants view access to a restricted label'
);
select ok(
  anttodo_private.can_view_task('40000000-0000-0000-0000-000000000001'),
  'member can view when every label is visible'
);
select ok(
  anttodo_private.can_view_task(
    (select id from public.tasks where title = 'Created in inbox')
  ),
  'workspace member can view an unlabeled inbox task'
);
select isnt(
  anttodo_private.can_edit_task(
    (select id from public.tasks where title = 'Created in inbox')
  ),
  true,
  'workspace member cannot edit another creator''s unlabeled inbox task'
);
select isnt(
  anttodo_private.can_edit_task('40000000-0000-0000-0000-000000000001'),
  true,
  'least-permissive label prevents editing'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select isnt(
  anttodo_private.can_view_task('40000000-0000-0000-0000-000000000001'),
  true,
  'outsider cannot view a task'
);
select is((select count(*)::integer from public.tasks), 0, 'RLS hides the task from outsiders');
select lives_ok(
  $$
    update public.tasks
    set kind = 'todo'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  'an unauthorized type update is safely filtered by RLS'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select kind
    from public.tasks
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  'note'::public.task_kind,
  'unauthorized users cannot change an item type'
);
select is(
  anttodo_private.label_permission_level_for_user(
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002'
  ),
  1,
  'assignment permission helper preserves explicit view access'
);
select is(
  anttodo_private.label_permission_level_for_user(
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000008'
  ),
  0,
  'assignment permission helper rejects a restricted workspace member'
);
select is(
  (
    select count(*)::integer
    from public.list_task_assignees(
      '40000000-0000-0000-0000-000000000001'
    )
  ),
  2,
  'task assignee candidates include only members who can view every label'
);
select is(
  (
    select count(*)::integer
    from public.list_task_assignees(
      (select id from public.tasks where title = 'Created in inbox')
    )
  ),
  3,
  'all workspace members can be assigned an unlabeled inbox task'
);
select lives_ok(
  $$
    select public.assign_task(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
  $$,
  'task editor can assign a task to a member with view access'
);
select is(
  (
    select assignee_id
    from public.tasks
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'assignment updates the task assignee'
);
select is(
  (
    select count(*)::integer
    from public.activity_events
    where task_id = '40000000-0000-0000-0000-000000000001'
      and event_type = 'task.assignee_changed'
      and payload = jsonb_build_object(
        'previous_assignee_id', null,
        'assignee_id', '10000000-0000-0000-0000-000000000002'::uuid
      )
  ),
  1,
  'assignment records the previous and next assignee'
);
select lives_ok(
  $$
    select public.assign_task(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
  $$,
  'repeating the current assignment succeeds'
);
select is(
  (
    select count(*)::integer
    from public.activity_events
    where task_id = '40000000-0000-0000-0000-000000000001'
      and event_type = 'task.assignee_changed'
  ),
  1,
  'repeating the current assignment does not add an activity event'
);
select throws_ok(
  $$
    select public.assign_task(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000008'
    )
  $$,
  '42501',
  'Assignee must be a workspace member who can view the task',
  'assignment rejects a member who cannot view every label'
);
select throws_ok(
  $$
    select public.assign_task(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003'
    )
  $$,
  '42501',
  'Assignee must be a workspace member who can view the task',
  'assignment rejects a user outside the workspace'
);
select throws_ok(
  $$
    update public.tasks
    set assignee_id = '10000000-0000-0000-0000-000000000008'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'Assignee must be a workspace member who can view the task',
  'direct updates cannot bypass assignee validation'
);
select throws_ok(
  $$
    select public.create_task_with_labels(
      '20000000-0000-0000-0000-000000000001',
      'Invalid assigned task',
      array['30000000-0000-0000-0000-000000000002'::uuid],
      '',
      null,
      'none',
      '10000000-0000-0000-0000-000000000008',
      null
    )
  $$,
  '42501',
  'Assignee must be a workspace member who can view the task',
  'task creation rejects an assignee without view access'
);
select lives_ok(
  $$
    select public.create_task_with_labels(
      '20000000-0000-0000-0000-000000000001',
      'Valid assigned task',
      array['30000000-0000-0000-0000-000000000002'::uuid],
      '',
      null,
      'none',
      '10000000-0000-0000-0000-000000000002',
      null
    )
  $$,
  'task creation accepts an assignee with view access'
);
select is(
  (
    select assignee_id
    from public.tasks
    where title = 'Valid assigned task'
  ),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'task creation saves the validated assignee'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    select public.assign_task(
      '40000000-0000-0000-0000-000000000001',
      null
    )
  $$,
  '42501',
  'Insufficient task permission',
  'a view-only member cannot change the assignee'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    select public.assign_task(
      '40000000-0000-0000-0000-000000000001',
      null
    )
  $$,
  'task editor can cancel an assignment'
);
select is(
  (
    select count(*)::integer
    from public.activity_events
    where task_id = '40000000-0000-0000-0000-000000000001'
      and event_type = 'task.assignee_changed'
  ),
  2,
  'cancelling an assignment records one additional activity event'
);

select has_table('public', 'task_list_preferences', 'task list preferences table exists');
select has_table('public', 'task_sections', 'shared task sections table exists');
select has_table('public', 'task_list_placements', 'task list placements table exists');
select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.task_list_preferences'::regclass,
      'public.task_sections'::regclass,
      'public.task_list_placements'::regclass
    )
  ),
  'all task list layout tables have RLS enabled'
);
select lives_ok(
  $$
    insert into public.task_list_preferences (
      user_id, workspace_id, list_key, grouping, sort, direction
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'label:30000000-0000-0000-0000-000000000001',
      'custom', 'custom', 'asc'
    )
  $$,
  'a user can save a preference for an editable label list'
);
select is(
  (
    select show_labels
    from public.task_list_preferences
    where user_id = '10000000-0000-0000-0000-000000000001'
      and workspace_id = '20000000-0000-0000-0000-000000000001'
      and list_key = 'label:30000000-0000-0000-0000-000000000001'
  ),
  false,
  'show_labels defaults to false for a newly saved preference'
);
select is(
  (
    select show_completed
    from public.task_list_preferences
    where user_id = '10000000-0000-0000-0000-000000000001'
      and workspace_id = '20000000-0000-0000-0000-000000000001'
      and list_key = 'label:30000000-0000-0000-0000-000000000001'
  ),
  false,
  'show_completed defaults to false for a newly saved preference'
);
select lives_ok(
  $$
    update public.task_list_preferences
    set show_labels = true
    where user_id = '10000000-0000-0000-0000-000000000001'
      and workspace_id = '20000000-0000-0000-0000-000000000001'
      and list_key = 'label:30000000-0000-0000-0000-000000000001'
  $$,
  'a user can update show_labels on their preference'
);
select is(
  (
    select show_labels
    from public.task_list_preferences
    where user_id = '10000000-0000-0000-0000-000000000001'
      and workspace_id = '20000000-0000-0000-0000-000000000001'
      and list_key = 'label:30000000-0000-0000-0000-000000000001'
  ),
  true,
  'show_labels persists after update'
);
select lives_ok(
  $$
    update public.task_list_preferences
    set show_completed = true
    where user_id = '10000000-0000-0000-0000-000000000001'
      and workspace_id = '20000000-0000-0000-0000-000000000001'
      and list_key = 'label:30000000-0000-0000-0000-000000000001'
  $$,
  'a user can update show_completed on their preference'
);
select is(
  (
    select show_completed
    from public.task_list_preferences
    where user_id = '10000000-0000-0000-0000-000000000001'
      and workspace_id = '20000000-0000-0000-0000-000000000001'
      and list_key = 'label:30000000-0000-0000-0000-000000000001'
  ),
  true,
  'show_completed persists after update'
);
select lives_ok(
  $$
    insert into public.task_sections (
      id, workspace_id, list_key, name, position, created_by
    ) values (
      '80000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'label:30000000-0000-0000-0000-000000000001',
      'Planning', 0,
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'a label editor can create a shared custom section'
);
select lives_ok(
  $$
    select public.set_task_list_order(
      '20000000-0000-0000-0000-000000000001',
      'label:30000000-0000-0000-0000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      array['40000000-0000-0000-0000-000000000001'::uuid]
    )
  $$,
  'a task editor can place a task in a shared custom section'
);
select is(
  (
    select section_id
    from public.task_list_placements
    where task_id = '40000000-0000-0000-0000-000000000001'
  ),
  '80000000-0000-4000-8000-000000000001'::uuid,
  'the transactional ordering RPC persists the selected section'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (
    select count(*)::integer
    from public.task_list_preferences
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  0,
  'another user cannot read task list preferences'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    delete from public.task_sections
    where id = '80000000-0000-4000-8000-000000000001'
  $$,
  'a label editor can delete a shared custom section'
);
select is(
  (
    select section_id
    from public.task_list_placements
    where task_id = '40000000-0000-0000-0000-000000000001'
  ),
  null::uuid,
  'deleting a section returns its tasks to the ungrouped section'
);

select has_table('public', 'task_comments', 'task comments table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.task_comments'::regclass),
  true,
  'task comments have RLS enabled'
);
set local role service_role;
select is(
  (select public from storage.buckets where id = 'comment-images'),
  false,
  'comment image bucket is private'
);
select ok(
  not exists (
    select 1 from storage.buckets
    where id = 'comment-images'
      and 'image/svg+xml' = any(allowed_mime_types)
  ),
  'comment image bucket rejects SVG uploads'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    select public.create_task_comment(
      '40000000-0000-0000-0000-000000000001',
      '@member please review',
      array[]::text[],
      array['10000000-0000-0000-0000-000000000002'::uuid]
    )
  $$,
  'a task owner can create a comment and mention a viewer'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.task_comments where body = '@member please review'),
  1,
  'a view-only task member can read comments'
);
select is(
  (select count(*)::integer from public.notifications
    where read_at is null
      and notification_type in ('comment_mention', 'note_mentioned')),
  1,
  'a mentioned member receives one unread notification'
);
select lives_ok(
  $$
    update public.notifications
    set read_at = now()
    where read_at is null
      and notification_type in ('comment_mention', 'note_mentioned')
  $$,
  'a notification recipient can mark their notification read'
);
select lives_ok(
  $$
    select public.create_task_comment(
      '40000000-0000-0000-0000-000000000001',
      'viewer comment',
      array[]::text[],
      array[]::uuid[]
    )
  $$,
  'a view-only task member can create a comment'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
delete from public.task_comments where body = 'viewer comment';
select is(
  (select count(*)::integer from public.task_comments where body = 'viewer comment'),
  1,
  'a different user cannot delete a comment'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    select public.create_task_comment(
      '40000000-0000-0000-0000-000000000001',
      'outsider comment',
      array[]::text[],
      array[]::uuid[]
    )
  $$,
  '42501',
  'Insufficient task permission',
  'an outsider cannot create a task comment'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    select public.create_task_comment(
      '40000000-0000-0000-0000-000000000001',
      '@owner self mention',
      array[]::text[],
      array['10000000-0000-0000-0000-000000000001'::uuid]
    )
  $$,
  'self mentions do not prevent comment creation'
);
select is(
  (select count(*)::integer from public.notifications where recipient_id = auth.uid()),
  0,
  'self mentions do not create notifications'
);
select lives_ok(
  $$
    select public.create_task_comment(
      '40000000-0000-0000-0000-000000000001',
      '@restricted hidden mention',
      array[]::text[],
      array['10000000-0000-0000-0000-000000000008'::uuid]
    )
  $$,
  'invisible mention candidates are ignored without failing the comment'
);
set local role service_role;
select is(
  (
    select count(*)::integer from public.notifications
    where recipient_id = '10000000-0000-0000-0000-000000000008'
  ),
  0,
  'members who cannot view the task receive no mention notification'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    select public.update_task_comment(
      (select id from public.task_comments where body = 'viewer comment'),
      '@owner edited comment',
      array[]::text[],
      array['10000000-0000-0000-0000-000000000001'::uuid]
    )
  $$,
  'a comment author can edit their own comment and mentions'
);
select is(
  (select body from public.task_comments where body = '@owner edited comment'),
  '@owner edited comment',
  'editing a comment persists its new body'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    select public.update_task_comment(
      (select id from public.task_comments where body = '@owner edited comment'),
      'unauthorized edit',
      array[]::text[],
      array[]::uuid[]
    )
  $$,
  '42501',
  'Insufficient comment permission',
  'a different user cannot edit a comment'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    select public.update_task_comment(
      (select id from public.task_comments where body = '@owner edited comment'),
      'viewer comment',
      array[]::text[],
      array[]::uuid[]
    )
  $$,
  'editing a comment can remove an existing mention'
);
set local role service_role;
select is(
  (
    select count(*)::integer from public.notifications
    where recipient_id = '10000000-0000-0000-0000-000000000001'
      and comment_id = (select id from public.task_comments where body = 'viewer comment')
  ),
  0,
  'removing a mention removes its notification'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select lives_ok(
  $$ delete from public.task_comments where body = 'viewer comment' $$,
  'a comment author can delete their own comment'
);

select has_table(
  'public',
  'workspace_invite_links',
  'workspace invite links table exists'
);
select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.workspace_invite_links'::regclass
  ),
  true,
  'workspace invite links have RLS enabled'
);
select table_privs_are(
  'public',
  'workspace_invite_links',
  'anon',
  array[]::text[],
  'anonymous users have no direct invite link table privileges'
);
select table_privs_are(
  'public',
  'workspace_invite_links',
  'authenticated',
  array[]::text[],
  'authenticated users have no direct invite link table privileges'
);
set local role service_role;
select lives_ok(
  $$
    insert into public.workspace_invite_links (
      id, workspace_id, role, created_by
    ) values (
      '70000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'member',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'an active workspace invite link can be created'
);
select throws_ok(
  $$
    insert into public.workspace_invite_links (
      workspace_id, role, created_by
    ) values (
      '20000000-0000-0000-0000-000000000001',
      'member',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '23505',
  null,
  'only one active invite link is allowed per workspace'
);
select throws_ok(
  $$
    insert into public.workspace_invite_links (
      workspace_id, role, created_by, revoked_at
    ) values (
      '20000000-0000-0000-0000-000000000001',
      'owner',
      '10000000-0000-0000-0000-000000000001',
      now()
    )
  $$,
  '23514',
  null,
  'invite links cannot grant the owner role'
);
select is(
  anttodo_private.accept_workspace_invite_link(
    '70000000-0000-4000-8000-000000000001',
    '10000000-0000-0000-0000-000000000003'
  ),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'an outsider can atomically accept an active link'
);
select is(
  (
    select role
    from public.workspace_members
    where workspace_id = '20000000-0000-0000-0000-000000000001'
      and user_id = '10000000-0000-0000-0000-000000000003'
  ),
  'member'::public.workspace_role,
  'a member link creates an ordinary member'
);
select lives_ok(
  $$
    update public.workspace_invite_links
    set role = 'admin'
    where id = '70000000-0000-4000-8000-000000000001'
  $$,
  'the active invite role can be updated'
);
select lives_ok(
  $$
    select anttodo_private.accept_workspace_invite_link(
      '70000000-0000-4000-8000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
  $$,
  'an existing member can reuse an administrator link'
);
select is(
  (
    select role
    from public.workspace_members
    where workspace_id = '20000000-0000-0000-0000-000000000001'
      and user_id = '10000000-0000-0000-0000-000000000002'
  ),
  'admin'::public.workspace_role,
  'an administrator link upgrades an existing member'
);
select lives_ok(
  $$
    select anttodo_private.accept_workspace_invite_link(
      '70000000-0000-4000-8000-000000000001',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'the workspace owner can accept an invite idempotently'
);
select is(
  (
    select role
    from public.workspace_members
    where workspace_id = '20000000-0000-0000-0000-000000000001'
      and user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'owner'::public.workspace_role,
  'accepting a link never downgrades the owner'
);
select lives_ok(
  $$
    update public.workspace_invite_links
    set revoked_at = now()
    where id = '70000000-0000-4000-8000-000000000001'
  $$,
  'an active invite link can be revoked'
);
select throws_ok(
  $$
    select anttodo_private.accept_workspace_invite_link(
      '70000000-0000-4000-8000-000000000001',
      '10000000-0000-0000-0000-000000000008'
    )
  $$,
  '22023',
  'Invite link revoked',
  'a revoked invite link cannot be accepted'
);
select lives_ok(
  $$
    insert into public.workspace_invite_links (
      id, workspace_id, role, created_by
    ) values (
      '70000000-0000-4000-8000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      'member',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  're-enabling invitations creates a new link identifier'
);
select is(
  (
    select count(*)::integer
    from public.workspace_invite_links
    where workspace_id = '20000000-0000-0000-0000-000000000001'
  ),
  2,
  'link rotation preserves the revoked link and its audit history'
);
set local role authenticated;

select lives_ok(
  $$
    select public.move_label_to_inbox(
      '30000000-0000-0000-0000-000000000001'
    )
  $$,
  'workspace owner can move an editable label to inbox'
);
select is(
  (
    select count(*)::integer
    from public.labels
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  0,
  'moving to inbox removes the source label'
);
select is(
  (
    select count(*)::integer
    from public.task_labels tl
    where tl.task_id = '40000000-0000-0000-0000-000000000001'
      and tl.label_id = '30000000-0000-0000-0000-000000000001'
  ),
  0,
  'moving to inbox removes the source label from associated tasks'
);
select is(
  (
    select parent_id
    from public.labels
    where id = '30000000-0000-0000-0000-000000000004'
  ),
  null::uuid,
  'direct child labels move to the label root'
);
select is(
  (
    select parent_id
    from public.labels
    where id = '30000000-0000-0000-0000-000000000005'
  ),
  '30000000-0000-0000-0000-000000000004'::uuid,
  'nested descendants remain attached to their direct parent'
);

reset role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '10000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'departing-owner@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '10000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'successor@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '10000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'sole-owner@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.workspaces (id, name, created_by) values
(
  '20000000-0000-0000-0000-000000000005',
  'Transferred workspace',
  '10000000-0000-0000-0000-000000000005'
),
(
  '20000000-0000-0000-0000-000000000007',
  'Sole owner workspace',
  '10000000-0000-0000-0000-000000000007'
);

insert into public.workspace_members (workspace_id, user_id, role)
values (
  '20000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000006',
  'admin'
);

insert into public.labels (workspace_id, name, created_by)
values (
  '20000000-0000-0000-0000-000000000005',
  'Former owner label',
  '10000000-0000-0000-0000-000000000005'
);

delete from auth.users
where id in (
  '10000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000007'
);

select is(
  (
    select count(*)::integer
    from public.workspaces
    where id = '20000000-0000-0000-0000-000000000005'
  ),
  1,
  'shared workspace remains after its owner deletes their account'
);
select is(
  (
    select role
    from public.workspace_members
    where workspace_id = '20000000-0000-0000-0000-000000000005'
      and user_id = '10000000-0000-0000-0000-000000000006'
  ),
  'owner'::public.workspace_role,
  'an admin becomes owner of a shared workspace'
);
select is(
  (
    select created_by
    from public.workspaces
    where id = '20000000-0000-0000-0000-000000000005'
  ),
  '10000000-0000-0000-0000-000000000006'::uuid,
  'shared workspace creator reference transfers to the successor'
);
select is(
  (
    select created_by
    from public.labels
    where workspace_id = '20000000-0000-0000-0000-000000000005'
      and name = 'Former owner label'
  ),
  null::uuid,
  'historical creator references are anonymized after account deletion'
);
select is(
  (
    select count(*)::integer
    from public.workspaces
    where id = '20000000-0000-0000-0000-000000000007'
  ),
  0,
  'a sole-owner workspace is deleted with the account'
);

select * from finish();
rollback;
