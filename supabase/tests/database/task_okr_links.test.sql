begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'link-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('a9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'link-member@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by) values
  ('b9000000-0000-0000-0000-000000000001', 'Link workspace', 'a9000000-0000-0000-0000-000000000001'),
  ('b9000000-0000-0000-0000-000000000002', 'Other link workspace', 'a9000000-0000-0000-0000-000000000001');
insert into public.workspace_members(workspace_id, user_id, role) values
  ('b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002', 'member');

insert into public.labels(id, workspace_id, name, kind, view_scope, manage_scope, inherit_permissions, created_by) values
  ('c9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Shared tasks', 'team', 'all', 'users', false, 'a9000000-0000-0000-0000-000000000001');
insert into public.label_user_acl(label_id, workspace_id, user_id, permission) values
  ('c9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002', 'view');
insert into public.connector_instances(
  id, workspace_id, type, name, enabled, schedule_minutes, target_label_id, public_config, created_by
) values (
  'c9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001',
  'yunxiao', 'Link connector', true, 30, 'c9000000-0000-0000-0000-000000000001',
  '{"organizationId":"org","projectId":"project","workitemTypeId":"task","workitemTypeName":"Task","categoryId":"TASK","conditions":[],"orderBy":"gmtCreate","sort":"desc","completedStatusId":"done","completedStatusName":"Done"}',
  'a9000000-0000-0000-0000-000000000001'
);

insert into public.tasks(id, workspace_id, title, kind, created_by) values
  ('d9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Main todo', 'todo', 'a9000000-0000-0000-0000-000000000001'),
  ('d9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001', 'Note', 'note', 'a9000000-0000-0000-0000-000000000001'),
  ('d9000000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000002', 'Other workspace todo', 'todo', 'a9000000-0000-0000-0000-000000000001');
insert into public.tasks(id, workspace_id, title, kind, created_by, connector_id, connector_platform, external_id) values
  ('d9000000-0000-0000-0000-000000000005', 'b9000000-0000-0000-0000-000000000001', 'Connector todo', 'todo', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', 'yunxiao', 'external-1');
insert into public.tasks(id, workspace_id, parent_task_id, title, kind, position, created_by) values
  ('d9000000-0000-0000-0000-000000000004', 'b9000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001', 'Child todo', 'todo', 0, 'a9000000-0000-0000-0000-000000000001');
insert into public.task_labels(task_id, label_id) values
  ('d9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001');

insert into public.okr_cycles(id, workspace_id, name, starts_on, ends_on, status, created_by) values
  ('e9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Active', current_date - 30, current_date + 30, 'active', 'a9000000-0000-0000-0000-000000000001'),
  ('e9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001', 'Draft', current_date + 31, current_date + 90, 'draft', 'a9000000-0000-0000-0000-000000000001'),
  ('e9000000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000002', 'Other active', current_date - 30, current_date + 30, 'active', 'a9000000-0000-0000-0000-000000000001');
insert into public.okr_sets(id, workspace_id, cycle_id, owner_id, visibility, published_at, published_version) values
  ('f9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'restricted', now(), 1),
  ('f9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002', 'workspace', now(), 1),
  ('f9000000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000001', 'workspace', null, 0),
  ('f9000000-0000-0000-0000-000000000004', 'b9000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-000000000001', 'workspace', now(), 1);
insert into public.okr_objectives(id, set_id, workspace_id, title) values
  ('01900000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Owner objective'),
  ('01900000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001', 'Member objective'),
  ('01900000-0000-0000-0000-000000000003', 'f9000000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000001', 'Draft objective'),
  ('01900000-0000-0000-0000-000000000004', 'f9000000-0000-0000-0000-000000000004', 'b9000000-0000-0000-0000-000000000002', 'Other objective');
insert into public.okr_key_results(id, objective_id, workspace_id, title, position) values
  ('02900000-0000-0000-0000-000000000001', '01900000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Owner KR one', 0),
  ('02900000-0000-0000-0000-000000000002', '01900000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Owner KR two', 1),
  ('02900000-0000-0000-0000-000000000003', '01900000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001', 'Member KR', 0),
  ('02900000-0000-0000-0000-000000000004', '01900000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000001', 'Draft KR', 0),
  ('02900000-0000-0000-0000-000000000005', '01900000-0000-0000-0000-000000000004', 'b9000000-0000-0000-0000-000000000002', 'Other KR', 0);

select ok(
  exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'task_okr_links'),
  'link changes are published to Realtime'
);
select ok(has_table_privilege('authenticated', 'public.task_okr_links', 'select'), 'authenticated clients can read links');
select ok(not has_table_privilege('authenticated', 'public.task_okr_links', 'insert'), 'authenticated clients cannot insert links directly');
select ok(not has_table_privilege('authenticated', 'public.task_okr_links', 'update'), 'authenticated clients cannot update links directly');
select ok(not has_table_privilege('authenticated', 'public.task_okr_links', 'delete'), 'authenticated clients cannot delete links directly');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000001', '02900000-0000-0000-0000-000000000001')$$, 'owner can link a main todo');
select lives_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000004', '02900000-0000-0000-0000-000000000001')$$, 'owner can link a child todo');
select lives_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000005', '02900000-0000-0000-0000-000000000001')$$, 'connector owner can link an external todo');
select lives_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000001', '02900000-0000-0000-0000-000000000002')$$, 'linking again atomically replaces the KR');
select is((select count(*)::integer from public.task_okr_links where task_id = 'd9000000-0000-0000-0000-000000000001'), 1, 'one task has at most one link');
select is((select key_result_id from public.task_okr_links where task_id = 'd9000000-0000-0000-0000-000000000001'), '02900000-0000-0000-0000-000000000002'::uuid, 'replacement stores the new KR');
select throws_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000001', '02900000-0000-0000-0000-000000000003')$$, '42501', null, 'another owner active KR is rejected');
select throws_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000001', '02900000-0000-0000-0000-000000000004')$$, '42501', null, 'draft cycle KR is rejected');
select throws_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000003', '02900000-0000-0000-0000-000000000001')$$, '22023', null, 'cross-workspace association is rejected');
select throws_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000002', '02900000-0000-0000-0000-000000000001')$$, '22023', null, 'notes cannot be associated');

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.task_okr_links), 0, 'RLS hides a link unless both task and KR are visible');

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$select public.set_task_okr_link('d9000000-0000-0000-0000-000000000001', null)$$, 'owner can remove an association');
select is((select count(*)::integer from public.task_okr_links where task_id = 'd9000000-0000-0000-0000-000000000001'), 0, 'removal deletes the link');

reset role;
update public.tasks set deleted_at = now() where id = 'd9000000-0000-0000-0000-000000000004';
select is((select count(*)::integer from public.task_okr_links where task_id = 'd9000000-0000-0000-0000-000000000004'), 1, 'soft deletion preserves the association');
delete from public.tasks where id = 'd9000000-0000-0000-0000-000000000004';
select is((select count(*)::integer from public.task_okr_links where task_id = 'd9000000-0000-0000-0000-000000000004'), 0, 'hard deletion cascades to the association');

select * from finish();
rollback;
