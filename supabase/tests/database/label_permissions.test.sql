begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'label-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'label-viewer@example.com', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'label-manager@example.com', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'label-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by) values
  ('92000000-0000-0000-0000-000000000001', 'Label permissions', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', 'Other workspace', '91000000-0000-0000-0000-000000000004');

insert into public.workspace_members(workspace_id, user_id, role) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', 'member'),
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003', 'member');

insert into public.user_groups(id, workspace_id, name, created_by) values
  ('93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'Readers', '91000000-0000-0000-0000-000000000001'),
  ('93000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', 'Managers', '91000000-0000-0000-0000-000000000001'),
  ('93000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000002', 'Other', '91000000-0000-0000-0000-000000000004');

insert into public.user_group_members(group_id, workspace_id, user_id) values
  ('93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002'),
  ('93000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003');

insert into public.labels(
  id, workspace_id, parent_id, name, kind, view_scope, manage_scope,
  inherit_permissions, created_by
) values
  ('94000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', null, 'Group label', 'team', 'groups', 'groups', false, '91000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', null, 'Private label', 'private', 'users', 'users', false, '91000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001', null, 'All managers', 'team', 'all', 'all', false, '91000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000003', 'Restricted child', 'team', 'users', 'users', true, '91000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000006', '92000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 'Inherited child', 'team', 'inherit', 'inherit', true, '91000000-0000-0000-0000-000000000001');

insert into public.labels(id, workspace_id, name, inherit_permissions, created_by)
values ('94000000-0000-0000-0000-000000000005', '92000000-0000-0000-0000-000000000001', 'Default private', false, '91000000-0000-0000-0000-000000000001');

select is((select kind from public.labels where id = '94000000-0000-0000-0000-000000000005'), 'private'::public.label_kind, 'new labels default to private');
select ok((select inherit_permissions from public.labels where id = '94000000-0000-0000-0000-000000000004'), 'child labels always inherit permissions');

insert into public.label_group_acl(label_id, workspace_id, group_id, permission) values
  ('94000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'view'),
  ('94000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000002', 'edit');

insert into public.label_user_acl(label_id, workspace_id, user_id, permission) values
  ('94000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', 'view');

insert into public.tasks(id, workspace_id, title, created_by) values
  ('95000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'Strict intersection', '91000000-0000-0000-0000-000000000001');
insert into public.task_labels(task_id, label_id) values
  ('95000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001'),
  ('95000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000003');

select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002'), 1, 'group grants view');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003'), 2, 'group grants management');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002'), 0, 'private label hides from members');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001'), 2, 'private label creator manages');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000002'), 2, 'all-users management grants edit');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000002'), 1, 'child intersects local and inherited permissions');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000003'), 0, 'child can further restrict inherited access');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000006', '91000000-0000-0000-0000-000000000002'), 1, 'inherited visibility follows the parent view grant');
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000006', '91000000-0000-0000-0000-000000000003'), 2, 'inherited management follows the parent edit grant');

delete from public.user_group_members
where group_id = '93000000-0000-0000-0000-000000000001'
  and user_id = '91000000-0000-0000-0000-000000000002';
select is(anttodo_private.label_permission_level_for_user('94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002'), 0, 'removing group membership revokes access immediately');

select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(anttodo_private.can_edit_task('95000000-0000-0000-0000-000000000001'), 'manager can edit a task when every label allows edit');

select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(anttodo_private.label_permission_level('94000000-0000-0000-0000-000000000001'), 2, 'workspace owner always manages labels');
select lives_ok(
  $$select public.update_label_with_access(
    '94000000-0000-0000-0000-000000000001', 'Updated group label', '#b8bdc8',
    'team', 'groups', 'groups',
    array['93000000-0000-0000-0000-000000000001']::uuid[],
    array['93000000-0000-0000-0000-000000000002']::uuid[], false
  )$$,
  'authorized manager can atomically save group access'
);
select throws_ok(
  $$select public.update_label_with_access(
    '94000000-0000-0000-0000-000000000001', 'Invalid group label', '#b8bdc8',
    'team', 'groups', 'groups',
    array['93000000-0000-0000-0000-000000000003']::uuid[],
    array['93000000-0000-0000-0000-000000000002']::uuid[], false
  )$$,
  '23503', 'Selected group does not belong to the workspace',
  'cross-workspace group ids are rejected'
);
select is((select count(*)::integer from public.label_group_acl where label_id = '94000000-0000-0000-0000-000000000001'), 2, 'failed atomic save preserves existing grants');

delete from public.user_groups where id = '93000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.label_group_acl where group_id = '93000000-0000-0000-0000-000000000001'), 0, 'deleting a group cascades label grants');

select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.labels where workspace_id = '92000000-0000-0000-0000-000000000001' and id = '94000000-0000-0000-0000-000000000002'), 0, 'RLS hides private labels from members');

select * from finish();
rollback;
