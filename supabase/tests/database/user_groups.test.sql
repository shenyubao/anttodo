begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'group-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'group-admin@example.com', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'group-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'group-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('21000000-0000-0000-0000-000000000001', 'User Group Test', '11000000-0000-0000-0000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'admin'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000003', 'member');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.user_groups (id, workspace_id, name, created_by) values (
    '31000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'Product',
    '11000000-0000-0000-0000-000000000001'
  )$$,
  'owner can create a user group'
);
select throws_ok(
  $$insert into public.user_groups (workspace_id, name, created_by) values (
    '21000000-0000-0000-0000-000000000001',
    ' product ',
    '11000000-0000-0000-0000-000000000001'
  )$$,
  '23505', null,
  'user group names are unique within a workspace regardless of case or surrounding spaces'
);
select lives_ok(
  $$insert into public.user_group_members (group_id, workspace_id, user_id) values (
    '31000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000003'
  )$$,
  'owner can add a workspace member to a group'
);
select throws_ok(
  $$insert into public.user_group_members (group_id, workspace_id, user_id) values (
    '31000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000004'
  )$$,
  '23503', null,
  'a group cannot contain a user outside its workspace'
);

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.user_groups), 1, 'members can read workspace groups');
select is((select count(*)::integer from public.user_group_members), 1, 'members can read group memberships');
select throws_ok(
  $$insert into public.user_groups (workspace_id, name, created_by) values (
    '21000000-0000-0000-0000-000000000001', 'Forbidden', '11000000-0000-0000-0000-000000000003'
  )$$,
  '42501', null,
  'members cannot create groups'
);
select results_eq(
  $$update public.user_groups set name = 'Forbidden' where id = '31000000-0000-0000-0000-000000000001' returning name$$,
  $$select null::text where false$$,
  'members cannot edit groups'
);
select results_eq(
  $$delete from public.user_groups where id = '31000000-0000-0000-0000-000000000001' returning id$$,
  $$select null::uuid where false$$,
  'members cannot delete groups'
);
select throws_ok(
  $$insert into public.user_group_members (group_id, workspace_id, user_id) values (
    '31000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000002'
  )$$,
  '42501', null,
  'members cannot add group members'
);

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.user_groups), 0, 'outsiders cannot read workspace groups');
select is((select count(*)::integer from public.user_group_members), 0, 'outsiders cannot read group memberships');

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$update public.user_groups set name = 'Product & Design' where id = '31000000-0000-0000-0000-000000000001'$$,
  'admins can edit groups'
);
select lives_ok(
  $$insert into public.user_group_members (group_id, workspace_id, user_id) values (
    '31000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000002'
  )$$,
  'admins can add group members'
);
select lives_ok(
  $$delete from public.user_groups where id = '31000000-0000-0000-0000-000000000001'$$,
  'admins can delete groups'
);
select is((select count(*)::integer from public.user_group_members), 0, 'deleting a group cascades to memberships');

select * from finish();
rollback;
