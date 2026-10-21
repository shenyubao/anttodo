begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'okr-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'okr-admin@example.com', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'okr-viewer@example.com', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'okr-group@example.com', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'okr-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by) values
  ('b1000000-0000-0000-0000-000000000001', 'OKR workspace', 'a1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002', 'Other workspace', 'a1000000-0000-0000-0000-000000000005');

insert into public.workspace_members(workspace_id, user_id, role) values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'admin'),
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'member'),
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 'member');

insert into public.user_groups(id, workspace_id, name, created_by) values
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'OKR readers', 'a1000000-0000-0000-0000-000000000001');
insert into public.user_group_members(group_id, workspace_id, user_id) values
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004');

insert into public.okr_cycles(id, workspace_id, name, starts_on, ends_on, status, created_by) values
  ('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '2026 Q3', '2026-07-01', '2026-09-30', 'active', 'a1000000-0000-0000-0000-000000000001'),
  ('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', '2026 Q4 draft', '2026-10-01', '2026-12-31', 'draft', 'a1000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);


reset role;
insert into public.okr_sets(id, workspace_id, cycle_id, owner_id) values
  ('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');
insert into public.okr_objectives(id, set_id, workspace_id, title) values
  ('f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Original'),
  ('f1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Alignment');
insert into public.okr_key_results(id, objective_id, workspace_id, title, weight) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'KR1', 50),
  ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'KR2', 50),
  ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'Other KR', 100);

set local role authenticated;
select ok(has_function_privilege('authenticated', 'public.save_okr_changes(uuid,jsonb,boolean)', 'execute'), 'authenticated can call save RPC');
select ok(not has_function_privilege('anon', 'public.save_okr_changes(uuid,jsonb,boolean)', 'execute'), 'anonymous cannot call save RPC');
select is((select prosecdef from pg_proc where oid = 'public.save_okr_changes(uuid,jsonb,boolean)'::regprocedure), false, 'save RPC uses invoker RLS');
select lives_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[{
    "id":"f1000000-0000-0000-0000-000000000001", "fields":{"title":"  Updated  ","note":"Saved together","visibility":"restricted"},
    "responsible_ids":["a1000000-0000-0000-0000-000000000003","a1000000-0000-0000-0000-000000000001"],
    "user_acl_ids":["a1000000-0000-0000-0000-000000000003"],
    "group_acl_ids":["c1000000-0000-0000-0000-000000000001"],
    "alignment_target_id":"f1000000-0000-0000-0000-000000000002",
    "key_results":[{"id":"f2000000-0000-0000-0000-000000000001","fields":{"title":"KR updated"},
      "responsible_ids":["a1000000-0000-0000-0000-000000000003"],
      "breakdowns":[{"user_id":"a1000000-0000-0000-0000-000000000003","allocated_value":100}]}]
  }]}');
$save$, 'one transaction saves the full set of field and relation changes');
select is((select title from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000001'), 'Updated', 'title is trimmed');
select is((select note from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000001'), 'Saved together', 'note saved');
select is((select title from public.okr_key_results where id = 'f2000000-0000-0000-0000-000000000001'), 'KR updated', 'KR saved');
select is((select count(*)::integer from public.okr_objective_responsibles), 2, 'responsibles saved');
select is((select position from public.okr_objective_responsibles where user_id = 'a1000000-0000-0000-0000-000000000001'), 1, 'responsible order preserved');
select is((select count(*)::integer from public.okr_objective_user_acl), 1, 'user ACL saved');
select is((select count(*)::integer from public.okr_objective_group_acl), 1, 'group ACL saved');
select is((select count(*)::integer from public.okr_objective_alignments), 1, 'alignment saved');
select is((select allocated_value from public.okr_kr_breakdowns limit 1), 100::numeric, 'breakdown saved');

-- Save no-op fields and relations; no row should be deleted/reinserted or touched.
update public.okr_objectives set updated_at = '2000-01-01T00:00:00Z'
  where id = 'f1000000-0000-0000-0000-000000000001';
reset role;
update public.okr_access_revisions set updated_at = '2000-01-01T00:00:00Z';
set local role authenticated;
create temporary table saved_state as select
  (select xmin::text from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000001') objective_xmin,
  (select id from public.okr_kr_breakdowns limit 1) breakdown_id;
select lives_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[{
    "id":"f1000000-0000-0000-0000-000000000001", "fields":{"title":"Updated","visibility":"restricted"},
    "responsible_ids":["a1000000-0000-0000-0000-000000000003","a1000000-0000-0000-0000-000000000001"],
    "user_acl_ids":["a1000000-0000-0000-0000-000000000003"],
    "key_results":[{"id":"f2000000-0000-0000-0000-000000000001","breakdowns":[{"user_id":"a1000000-0000-0000-0000-000000000003","allocated_value":100}]}]
  }]}');
$save$, 'unchanged values are accepted');
select is((select updated_at from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000001'), '2000-01-01T00:00:00Z'::timestamptz, 'no-op fields do not touch the Objective');
select is((select updated_at from public.okr_access_revisions where cycle_id = 'd1000000-0000-0000-0000-000000000001'), '2000-01-01T00:00:00Z'::timestamptz, 'unchanged ACLs do not emit access revisions');
select is((select id from public.okr_kr_breakdowns limit 1), (select breakdown_id from saved_state), 'unchanged breakdown keeps its identity');
select throws_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[{
    "id":"f1000000-0000-0000-0000-000000000001", "fields":{"title":"Must roll back"},
    "key_results":[{"id":"f2000000-0000-0000-0000-000000000003","fields":{"title":"Injected"}}]
  }]}');
$save$, '42501', 'Key Result does not belong to this Objective', 'foreign KR rejects transaction');
select is((select title from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000001'), 'Updated', 'earlier field write rolled back');
select throws_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[{
    "id":"f1000000-0000-0000-0000-000000000001", "fields":{"set_id":"e1000000-0000-0000-0000-000000000002"}
  }]}');
$save$, 'P0001', 'Invalid OKR fields', 'immutable ownership fields rejected');
select lives_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[{
    "id":"f1000000-0000-0000-0000-000000000001", "responsible_ids":[],"user_acl_ids":[],"group_acl_ids":[],"alignment_target_id":null,
    "key_results":[{"id":"f2000000-0000-0000-0000-000000000001","breakdowns":[]}]
  }]}');
$save$, 'relations can be explicitly cleared');
select is((select count(*)::integer from public.okr_objective_responsibles), 0, 'responsibles cleared');
select is((select count(*)::integer from public.okr_objective_alignments), 0, 'alignment cleared');
select is((public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[]}', true) ->> 'published_version')::integer, 1, 'publishes and returns canonical full set');
select is((select count(*)::integer from public.okr_versions), 1, 'one publication creates one snapshot');
select throws_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[{
    "id":"f1000000-0000-0000-0000-000000000001", "fields":{"title":"Invalid publication"},
    "key_results":[{"id":"f2000000-0000-0000-0000-000000000001","fields":{"weight":40}}]
  }]}', true);
$save$, 'P0001', 'Key Result weights must add up to 100 for objective "Invalid publication"', 'publish validation rejects the whole save');
select is((select title from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000001'), 'Updated', 'failed publication rolls back draft edits');
select is((select count(*)::integer from public.okr_versions), 1, 'failed publication does not create another snapshot');
select throws_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000002', '{"objectives":[]}');
$save$, '42501', 'Only the OKR owner can edit an active cycle', 'draft cycle rejects writes');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($save$
  select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives":[]}');
$save$, '42501', 'Only the OKR owner can edit an active cycle', 'workspace admin cannot edit another owner OKR');
select * from finish();
rollback;
