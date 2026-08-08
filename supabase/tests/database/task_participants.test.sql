begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('13100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'participant-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('13100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'participant-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('13100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'participant-viewer@example.com', '', now(), '{}', '{}', now(), now()),
  ('13100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'participant-outsider@example.com', '', now(), '{}', '{}', now(), now());

update public.profiles set display_name = 'Owner' where id = '13100000-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Member' where id = '13100000-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Viewer' where id = '13100000-0000-0000-0000-000000000003';
update public.profiles set display_name = 'Outsider' where id = '13100000-0000-0000-0000-000000000004';

insert into public.workspaces(id, name, created_by)
values ('23100000-0000-0000-0000-000000000001', 'Participants Test', '13100000-0000-0000-0000-000000000001');

insert into public.workspace_members(workspace_id, user_id, role) values
  ('23100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000002', 'member'),
  ('23100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000003', 'member');

insert into public.labels(
  id, workspace_id, name, kind, view_scope, manage_scope, inherit_permissions, created_by
) values (
  '33100000-0000-0000-0000-000000000001',
  '23100000-0000-0000-0000-000000000001',
  'Shared',
  'team',
  'users',
  'users',
  false,
  '13100000-0000-0000-0000-000000000001'
);

insert into public.label_user_acl(label_id, workspace_id, user_id, permission) values
  ('33100000-0000-0000-0000-000000000001', '23100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000002', 'edit'),
  ('33100000-0000-0000-0000-000000000001', '23100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000003', 'view');

insert into public.tasks(id, workspace_id, title, created_by)
values ('43100000-0000-0000-0000-000000000001', '23100000-0000-0000-0000-000000000001', 'Shared task', '13100000-0000-0000-0000-000000000001');

insert into public.task_labels(task_id, label_id)
values ('43100000-0000-0000-0000-000000000001', '33100000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    insert into public.task_participants(task_id, user_id)
    values ('43100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000002')
  $$,
  'editor can add a viewable member as participant'
);

select is(
  (
    select created_by
    from public.task_participants
    where task_id = '43100000-0000-0000-0000-000000000001'
      and user_id = '13100000-0000-0000-0000-000000000002'
  ),
  '13100000-0000-0000-0000-000000000001'::uuid,
  'insert trigger fills created_by from auth.uid'
);

select is(
  (
    select count(*)::integer
    from public.activity_events
    where task_id = '43100000-0000-0000-0000-000000000001'
      and event_type = 'task.participant_added'
      and payload = jsonb_build_object(
        'user_id', '13100000-0000-0000-0000-000000000002'::uuid,
        'display_name', 'Member'
      )
  ),
  1,
  'adding a participant records an activity event'
);

reset role;

select is(
  (
    select notification_type
    from public.notifications
    where task_id = '43100000-0000-0000-0000-000000000001'
      and recipient_id = '13100000-0000-0000-0000-000000000002'
      and notification_type = 'participant_added'
    limit 1
  ),
  'participant_added',
  'adding a participant notifies the newly added user'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '43100000-0000-0000-0000-000000000001'
      and recipient_id = '13100000-0000-0000-0000-000000000001'
      and notification_type = 'participant_added'
  ),
  0,
  'adding a participant does not notify the actor'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$
    insert into public.task_participants(task_id, user_id)
    values ('43100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000002')
  $$,
  '23505',
  null,
  'duplicate participants are rejected by the primary key'
);

select throws_ok(
  $$
    insert into public.task_participants(task_id, user_id)
    values ('43100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000004')
  $$,
  '42501',
  'Participant must be a workspace member who can view the task',
  'outsider cannot be added as a participant'
);

select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is(
  (
    select count(*)::integer
    from public.task_participants
    where task_id = '43100000-0000-0000-0000-000000000001'
  ),
  1,
  'view-only member can see participants'
);

select throws_ok(
  $$
    insert into public.task_participants(task_id, user_id)
    values ('43100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000003')
  $$,
  '42501',
  'new row violates row-level security policy for table "task_participants"',
  'view-only member cannot add participants'
);

select lives_ok(
  $$
    delete from public.task_participants
    where task_id = '43100000-0000-0000-0000-000000000001'
      and user_id = '13100000-0000-0000-0000-000000000002'
  $$,
  'view-only delete attempt does not error'
);

select is(
  (
    select count(*)::integer
    from public.task_participants
    where task_id = '43100000-0000-0000-0000-000000000001'
      and user_id = '13100000-0000-0000-0000-000000000002'
  ),
  1,
  'view-only member cannot remove participants'
);

select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    delete from public.task_participants
    where task_id = '43100000-0000-0000-0000-000000000001'
      and user_id = '13100000-0000-0000-0000-000000000002'
  $$,
  'editor can remove a participant'
);

select is(
  (
    select count(*)::integer
    from public.activity_events
    where task_id = '43100000-0000-0000-0000-000000000001'
      and event_type = 'task.participant_removed'
      and payload = jsonb_build_object(
        'user_id', '13100000-0000-0000-0000-000000000002'::uuid,
        'display_name', 'Member'
      )
  ),
  1,
  'removing a participant records an activity event'
);

select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select is(
  (
    select count(*)::integer
    from public.task_participants
    where task_id = '43100000-0000-0000-0000-000000000001'
  ),
  0,
  'outsider cannot see participants'
);

select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$
    insert into public.task_participants(task_id, user_id)
    values ('43100000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000003')
  $$,
  'edit-capable member can add another viewable participant'
);

select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    select public.create_task_with_labels(
      p_workspace_id => '23100000-0000-0000-0000-000000000001',
      p_title => 'Unassigned auto-watch',
      p_label_ids => array['33100000-0000-0000-0000-000000000001'::uuid]
    )
  $$,
  'create task without assignee succeeds'
);

select is(
  (
    select count(*)::integer
    from public.task_participants tp
    join public.tasks t on t.id = tp.task_id
    where t.title = 'Unassigned auto-watch'
      and tp.user_id = '13100000-0000-0000-0000-000000000001'
  ),
  1,
  'unassigned create adds creator as participant'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.notifications n
    join public.tasks t on t.id = n.task_id
    where t.title = 'Unassigned auto-watch'
      and n.notification_type = 'participant_added'
  ),
  0,
  'auto-watch creator does not notify self as participant_added'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    select public.create_task_with_labels(
      p_workspace_id => '23100000-0000-0000-0000-000000000001',
      p_title => 'Assigned to other auto-watch',
      p_label_ids => array['33100000-0000-0000-0000-000000000001'::uuid],
      p_assignee_id => '13100000-0000-0000-0000-000000000002'
    )
  $$,
  'create task assigned to another member succeeds'
);

select is(
  (
    select count(*)::integer
    from public.task_participants tp
    join public.tasks t on t.id = tp.task_id
    where t.title = 'Assigned to other auto-watch'
      and tp.user_id = '13100000-0000-0000-0000-000000000001'
  ),
  1,
  'assign-to-other create adds creator as participant'
);

select lives_ok(
  $$
    select public.create_task_with_labels(
      p_workspace_id => '23100000-0000-0000-0000-000000000001',
      p_title => 'Self-assigned no auto-watch',
      p_label_ids => array['33100000-0000-0000-0000-000000000001'::uuid],
      p_assignee_id => '13100000-0000-0000-0000-000000000001'
    )
  $$,
  'create task assigned to self succeeds'
);

select is(
  (
    select count(*)::integer
    from public.task_participants tp
    join public.tasks t on t.id = tp.task_id
    where t.title = 'Self-assigned no auto-watch'
      and tp.user_id = '13100000-0000-0000-0000-000000000001'
  ),
  0,
  'self-assigned create does not add creator as participant'
);

select * from finish();
rollback;
