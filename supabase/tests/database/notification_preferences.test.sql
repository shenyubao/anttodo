begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('14100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('14100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('14100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-participant@example.com', '', now(), '{}', '{}', now(), now());

update public.profiles set display_name = 'Owner' where id = '14100000-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Member' where id = '14100000-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Participant' where id = '14100000-0000-0000-0000-000000000003';

insert into public.workspaces(id, name, created_by)
values ('24100000-0000-0000-0000-000000000001', 'Notify Test', '14100000-0000-0000-0000-000000000001');

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
  ('34100000-0000-0000-0000-000000000001', '24100000-0000-0000-0000-000000000001', '14100000-0000-0000-0000-000000000003', 'edit');

insert into public.tasks(id, workspace_id, title, created_by, assignee_id)
values (
  '44100000-0000-0000-0000-000000000001',
  '24100000-0000-0000-0000-000000000001',
  'Notify task',
  '14100000-0000-0000-0000-000000000001',
  null
);

insert into public.task_labels(task_id, label_id)
values ('44100000-0000-0000-0000-000000000001', '34100000-0000-0000-0000-000000000001');

insert into public.task_participants(task_id, user_id, created_by)
values (
  '44100000-0000-0000-0000-000000000001',
  '14100000-0000-0000-0000-000000000003',
  '14100000-0000-0000-0000-000000000001'
);

-- Preference defaults (missing row) are enabled.
select ok(
  anttodo_private.notification_pref_enabled(
    '14100000-0000-0000-0000-000000000002',
    'task_assigned',
    'system'
  ),
  'missing preference row defaults system channel to enabled'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$
    insert into public.user_notification_preferences(user_id, scenario, system_enabled, dingtalk_enabled)
    values (
      '14100000-0000-0000-0000-000000000002',
      'task_assigned',
      false,
      true
    )
  $$,
  'user can insert own notification preferences'
);

select throws_ok(
  $$
    insert into public.user_notification_preferences(user_id, scenario, system_enabled, dingtalk_enabled)
    values (
      '14100000-0000-0000-0000-000000000001',
      'task_assigned',
      false,
      true
    )
  $$,
  '42501',
  null,
  'user cannot insert preferences for another user'
);

select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    update public.tasks
    set assignee_id = '14100000-0000-0000-0000-000000000002'
    where id = '44100000-0000-0000-0000-000000000001'
  $$,
  'owner can assign task'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000002'
      and notification_type = 'task_assigned'
  ),
  0,
  'assignment is buffered and does not write public.notifications immediately'
);

select is(
  (
    select count(*)::integer
    from anttodo_private.notification_dispatch_buffer
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000002'
      and notification_type = 'task_assigned'
  ),
  1,
  'assignment stages task_assigned in the dispatch buffer'
);

select is(
  anttodo_private.force_flush_notification_dispatch_buffer() >= 1,
  true,
  'force flush drains due buffered notifications'
);

select is(
  (
    select notification_type
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000002'
      and notification_type = 'task_assigned'
    limit 1
  ),
  'task_assigned',
  'assignment creates task_assigned notification after flush for new assignee'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000001'
      and notification_type = 'task_assigned'
  ),
  0,
  'assigning someone else does not notify the actor'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    update public.tasks
    set assignee_id = '14100000-0000-0000-0000-000000000001'
    where id = '44100000-0000-0000-0000-000000000001'
  $$,
  'owner can self-assign task'
);

reset role;

select is(
  anttodo_private.force_flush_notification_dispatch_buffer() >= 1,
  true,
  'flush after self-assign'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000001'
      and notification_type = 'task_assigned'
  ),
  1,
  'self-assignment notifies the actor as assignee'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    update public.tasks
    set title = 'Notify task renamed once'
    where id = '44100000-0000-0000-0000-000000000001'
  $$,
  'owner renames task first time'
);

select lives_ok(
  $$
    update public.tasks
    set title = 'Notify task renamed twice'
    where id = '44100000-0000-0000-0000-000000000001'
  $$,
  'owner renames task second time'
);

select lives_ok(
  $$
    update public.tasks
    set status = 'completed',
        completed_at = now()
    where id = '44100000-0000-0000-0000-000000000001'
  $$,
  'owner completes task after renames'
);

reset role;

select is(
  (
    select count(*)::integer
    from anttodo_private.notification_dispatch_buffer
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_title_changed'
  ),
  1,
  'same-scenario title edits collapse to one buffer row'
);

select is(
  (
    select payload->>'before'
    from anttodo_private.notification_dispatch_buffer
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_title_changed'
  ),
  'Notify task',
  'merged title payload keeps first before value'
);

select is(
  (
    select payload->>'after'
    from anttodo_private.notification_dispatch_buffer
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_title_changed'
  ),
  'Notify task renamed twice',
  'merged title payload uses latest after value'
);

select is(
  (
    select count(*)::integer
    from anttodo_private.notification_dispatch_buffer
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_status_changed'
  ),
  1,
  'title and status changes stay on separate scenarios'
);

select is(
  anttodo_private.force_flush_notification_dispatch_buffer() >= 1,
  true,
  'flush title/status buffer rows'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_title_changed'
  ),
  1,
  'title change notifies participants after flush'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    update public.tasks
    set status = 'open',
        completed_at = null,
        assignee_id = '14100000-0000-0000-0000-000000000002'
    where id = '44100000-0000-0000-0000-000000000001'
  $$,
  'owner reopens task and restores assignee for comment test'
);

reset role;

select is(
  anttodo_private.force_flush_notification_dispatch_buffer() >= 0,
  true,
  'flush reopen/assign buffer rows'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$
    select public.create_task_comment(
      '44100000-0000-0000-0000-000000000001',
      'hello assignee and participant',
      array[]::text[],
      array[]::uuid[]
    )
  $$,
  'assignee can comment'
);

reset role;

select is(
  anttodo_private.force_flush_notification_dispatch_buffer() >= 1,
  true,
  'flush comment buffer rows'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000002'
      and notification_type = 'task_new_comment'
  ),
  1,
  'comment author who is assignee is also notified via task_new_comment'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_new_comment'
  ),
  1,
  'new comment notifies participants'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    insert into public.subtasks(task_id, title, position, created_by)
    values (
      '44100000-0000-0000-0000-000000000001',
      'Sub A',
      0,
      '14100000-0000-0000-0000-000000000001'
    )
  $$,
  'owner can create subtask'
);

reset role;

select is(
  anttodo_private.force_flush_notification_dispatch_buffer() >= 1,
  true,
  'flush subtask buffer rows'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_subtask_created'
  ),
  1,
  'subtask create notifies participants'
);

-- Mention cancels pending comment buffer for the mentioned user.
delete from anttodo_private.notification_dispatch_buffer;
delete from public.notifications
where task_id = '44100000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$
    select public.create_task_comment(
      '44100000-0000-0000-0000-000000000001',
      '@participant please review',
      array[]::text[],
      array['14100000-0000-0000-0000-000000000003'::uuid]
    )
  $$,
  'owner can comment with mention'
);

reset role;

select is(
  (
    select count(*)::integer
    from anttodo_private.notification_dispatch_buffer
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'participant_new_comment'
  ),
  0,
  'mention cancels buffered participant_new_comment for mentioned user'
);

select is(
  (
    select count(*)::integer
    from anttodo_private.notification_dispatch_buffer
    where task_id = '44100000-0000-0000-0000-000000000001'
      and recipient_id = '14100000-0000-0000-0000-000000000003'
      and notification_type = 'todo_mentioned'
  ),
  1,
  'mention stages todo_mentioned buffer for mentioned user'
);

select * from finish();
rollback;
