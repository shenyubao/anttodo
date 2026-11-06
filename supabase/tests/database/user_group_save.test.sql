begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

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


select lives_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 ' Product ', array['11000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000003']::uuid[]
)$q$, 'owner creates group and deduplicates members in one transaction');
select is((select name from public.user_groups where id='31000000-0000-0000-0000-000000000011'), 'Product', 'name is trimmed');
select is((select count(*)::int from public.user_group_members where group_id='31000000-0000-0000-0000-000000000011'), 1, 'members are deduplicated');

select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 'Should Roll Back', array['11000000-0000-0000-0000-000000000004']::uuid[],
 'Product', array['11000000-0000-0000-0000-000000000003']::uuid[]
)$q$, '23503', null, 'outsider membership is rejected');
select is((select name from public.user_groups where id='31000000-0000-0000-0000-000000000011'), 'Product', 'invalid save does not change name');
select is((select count(*)::int from public.user_group_members where group_id='31000000-0000-0000-0000-000000000011'), 1, 'invalid save does not change memberships');

update public.user_groups set name='Changed remotely' where id='31000000-0000-0000-0000-000000000011';
select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 'Overwrite', '{}'::uuid[], 'Product', array['11000000-0000-0000-0000-000000000003']::uuid[]
)$q$, 'PT409', null, 'stale editor cannot overwrite remote name');
select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 'Overwrite', '{}'::uuid[], 'Changed remotely', '{}'::uuid[]
)$q$, 'PT409', null, 'stale membership snapshot is rejected');
select is((public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 'Changed remotely', array['11000000-0000-0000-0000-000000000003']::uuid[],
 'Changed remotely', array['11000000-0000-0000-0000-000000000003']::uuid[]
)->>'members_changed')::boolean, false, 'no-op reports no membership changes');

select lives_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000012', 'Second', '{}'::uuid[]
)$q$, 'empty group can be created');
select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 ' second ', '{}'::uuid[], 'Changed remotely', array['11000000-0000-0000-0000-000000000003']::uuid[]
)$q$, '23505', null, 'duplicate name rolls transaction back');
select is((select count(*)::int from public.user_group_members where group_id='31000000-0000-0000-0000-000000000011'), 1, 'duplicate-name rollback preserves memberships');
select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 '', '{}'::uuid[], 'Changed remotely', array['11000000-0000-0000-0000-000000000003']::uuid[]
)$q$, '23514', null, 'blank name is rejected');

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000013', 'Forbidden', '{}'::uuid[]
)$q$, '42501', null, 'ordinary member cannot call save RPC');
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000013', 'Forbidden', '{}'::uuid[]
)$q$, '42501', null, 'outsider cannot call save RPC');

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 'Changed remotely', array['11000000-0000-0000-0000-000000000002']::uuid[],
 'Changed remotely', array['11000000-0000-0000-0000-000000000003']::uuid[]
)->>'members_changed')::boolean, true, 'admin can replace members');
select is((select user_id::text from public.user_group_members where group_id='31000000-0000-0000-0000-000000000011'), '11000000-0000-0000-0000-000000000002', 'member replacement is exact');
select lives_ok($q$delete from public.user_groups where id='31000000-0000-0000-0000-000000000011'$q$, 'group can still be deleted through table API');
select is((select count(*)::int from public.user_group_members where group_id='31000000-0000-0000-0000-000000000011'), 0, 'deletion cascades to memberships');
select throws_ok($q$select public.save_user_group(
 '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011',
 'Resurrect', '{}'::uuid[], 'Changed remotely', array['11000000-0000-0000-0000-000000000002']::uuid[]
)$q$, 'PT409', null, 'saving a deleted group does not recreate it');
select ok(not has_function_privilege('anon', 'public.save_user_group(uuid,uuid,text,uuid[],text,uuid[])', 'EXECUTE'), 'anonymous role cannot execute RPC');
select * from finish();
rollback;
