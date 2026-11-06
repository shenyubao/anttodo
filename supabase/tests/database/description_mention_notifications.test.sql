begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('14600000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mention-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('14600000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mention-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('14600000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mention-outsider@example.com', '', now(), '{}', '{}', now(), now());

update public.profiles set display_name = 'Owner' where id = '14600000-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Member' where id = '14600000-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Participant' where id = '14600000-0000-0000-0000-000000000003';

insert into public.workspaces(id, name, created_by)
values ('24600000-0000-0000-0000-000000000001', 'Notify Test', '14600000-0000-0000-0000-000000000001');

insert into public.workspace_members(workspace_id, user_id, role) values
  ('24600000-0000-0000-0000-000000000001', '14600000-0000-0000-0000-000000000002', 'member');

insert into public.labels(
  id, workspace_id, name, kind, view_scope, manage_scope, inherit_permissions, created_by
) values (
  '34600000-0000-0000-0000-000000000001',
  '24600000-0000-0000-0000-000000000001',
  'Shared',
  'team',
  'users',
  'users',
  false,
  '14600000-0000-0000-0000-000000000001'
);

insert into public.label_user_acl(label_id, workspace_id, user_id, permission) values
  ('34600000-0000-0000-0000-000000000001', '24600000-0000-0000-0000-000000000001', '14600000-0000-0000-0000-000000000002', 'edit');

insert into public.tasks(id, workspace_id, title, created_by, assignee_id)
values (
  '44600000-0000-0000-0000-000000000001',
  '24600000-0000-0000-0000-000000000001',
  'Notify task',
  '14600000-0000-0000-0000-000000000001',
  null
);

insert into public.task_labels(task_id, label_id)
values ('44600000-0000-0000-0000-000000000001', '34600000-0000-0000-0000-000000000001');


-- Capture the dispatch boundary transactionally; do not send real IM in tests.
create table anttodo_private.mention_test_dispatch_calls (notification_id uuid);
create or replace function anttodo_private.enqueue_notification_dispatch(p_notification_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  insert into anttodo_private.mention_test_dispatch_calls values (p_notification_id);
  return 1;
end;
$$;

select ok(not has_function_privilege('anon', 'public.send_task_description_mention_notification(uuid,uuid,uuid)', 'execute'), 'anonymous callers cannot send');
select set_config('request.jwt.claims', '{"sub":"14600000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.update_task_description('44600000-0000-0000-0000-000000000001', '@Member hello', array['14600000-0000-0000-0000-000000000002'::uuid])$$, 'save mention');
reset role;
select is((select count(*)::integer from public.task_description_mentions where task_id='44600000-0000-0000-0000-000000000001'), 1, 'mention is persisted');
select is((select count(*)::integer from public.notifications where task_id='44600000-0000-0000-0000-000000000001'), 0, 'save is silent');
select is((select count(*)::integer from anttodo_private.notification_dispatch_buffer where task_id='44600000-0000-0000-0000-000000000001'), 0, 'save stages no buffered notification');
set local role authenticated;
select lives_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000001')$$, 'explicit send succeeds');
reset role;
select is((select count(*)::integer from public.notifications where task_id='44600000-0000-0000-0000-000000000001' and notification_type='todo_mentioned'), 1, 'explicit send immediately creates the in-app notification');
select is((select count(*)::integer from anttodo_private.mention_test_dispatch_calls), 1, 'explicit send immediately invokes dispatch');
select is((select count(*)::integer from anttodo_private.notification_dispatch_buffer where task_id='44600000-0000-0000-0000-000000000001'), 0, 'manual send bypasses the debounce buffer');
select is((select payload from public.notifications where task_id='44600000-0000-0000-0000-000000000001'), '{"source":"description","manual_send":true}'::jsonb, 'manual IM override is set by the server');
select is(public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000001'), (select id from public.notifications where task_id='44600000-0000-0000-0000-000000000001'), 'retries return the same notification ID');
select is((select count(*)::integer from anttodo_private.mention_test_dispatch_calls), 1, 'retries do not dispatch twice');
update public.tasks set kind='note' where id='44600000-0000-0000-0000-000000000001';
select is(public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000001'), (select id from public.notifications where task_id='44600000-0000-0000-0000-000000000001'), 'a retry after task kind conversion returns the original notification');
select is((select count(*)::integer from anttodo_private.mention_test_dispatch_calls), 1, 'kind conversion does not cause duplicate dispatch');
update public.tasks set kind='todo' where id='44600000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000003','64600000-0000-0000-0000-000000000002')$$, '42501', 'Recipient cannot view this task', 'reject an inaccessible recipient');
select throws_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002',null)$$, '22023', 'Recipient and request ID are required', 'request ID is required');
reset role;
select set_config('request.jwt.claims', '{"sub":"14600000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000002')$$, '42501', 'Insufficient task permission', 'non-editor cannot send');
reset role;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000002')$$, '42501', 'Insufficient task permission', 'authenticated role without identity cannot send');
select set_config('request.jwt.claims', '{"sub":"14600000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.update_task_description('44600000-0000-0000-0000-000000000001', 'removed', array['14600000-0000-0000-0000-000000000002'::uuid]);
select throws_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000002')$$, '22023', 'Mention is absent from description', 'mention text must still exist');
select public.update_task_description('44600000-0000-0000-0000-000000000001', '@Member hello', array[]::uuid[]);
select throws_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000002')$$, '22023', 'Mention is absent from description', 'plain text without a recorded mention cannot notify');
select public.update_task_description('44600000-0000-0000-0000-000000000001', '@Member note', array['14600000-0000-0000-0000-000000000002'::uuid]);
update public.tasks set kind='note' where id='44600000-0000-0000-0000-000000000001';
select lives_ok($$select public.send_task_description_mention_notification('44600000-0000-0000-0000-000000000001','14600000-0000-0000-0000-000000000002','64600000-0000-0000-0000-000000000003')$$, 'note mentions can send');
reset role;
select is((select count(*)::integer from public.notifications where task_id='44600000-0000-0000-0000-000000000001' and notification_type='note_mentioned'), 1, 'notes use note_mentioned');
select * from finish();
rollback;
