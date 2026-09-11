begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

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

select lives_ok(
  $$insert into public.okr_sets(id, workspace_id, cycle_id, owner_id) values
    ('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')
    returning id$$,
  'the owner can create and return their OKR set'
);
select is(
  (select visibility from public.okr_sets where id = 'e1000000-0000-0000-0000-000000000001'),
  'workspace'::public.okr_visibility,
  'new OKR sets default to workspace visibility'
);

select lives_ok(
  $$insert into public.okr_objectives(id, set_id, workspace_id, title) values
    ('f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Grow the product')
    returning id$$,
  'the owner can create and return an Objective'
);
select lives_ok(
  $$insert into public.okr_key_results(id, objective_id, workspace_id, title) values
    ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Reach 100 active teams')
    returning id$$,
  'the owner can create and return a Key Result'
);
insert into public.okr_objective_responsibles(objective_id, workspace_id, user_id) values
  ('f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003');
select is((select count(*)::integer from public.okr_sets), 1, 'the owner can read an unpublished draft');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_sets), 0, 'unpublished OKR sets do not leak into the employee list');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.publish_okr_set('e1000000-0000-0000-0000-000000000001')$$,
  'the owner can publish an active cycle'
);
select lives_ok(
  $$insert into public.okr_objectives(id, set_id, workspace_id, title) values
    ('f1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Broken weights')
    returning id$$,
  'the owner can add another Objective'
);
select lives_ok(
  $$insert into public.okr_key_results(id, objective_id, workspace_id, title) values
    ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'KR A'),
    ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'KR B')$$,
  'two Key Results default to weight 100'
);
select lives_ok(
  $$select public.publish_okr_set('e1000000-0000-0000-0000-000000000001')$$,
  'publishing equalizes Key Result weights left at the default'
);
select results_eq(
  $$select weight from public.okr_key_results
    where objective_id = 'f1000000-0000-0000-0000-000000000002'
    order by position, id$$,
  $$values (50::numeric), (50::numeric)$$,
  'unfilled Key Result weights are split evenly on publish'
);
delete from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000002';
select lives_ok(
  $$insert into public.okr_objectives(id, set_id, workspace_id, title) values
    ('f1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Incomplete weights')
    returning id$$,
  'the owner can add an Objective with incomplete weights'
);
select lives_ok(
  $$insert into public.okr_key_results(id, objective_id, workspace_id, title, weight) values
    ('f2000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'KR A', 40),
    ('f2000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'KR B', 40)$$,
  'Key Results can be stored with weights that do not sum to 100'
);
select throws_ok(
  $$select public.publish_okr_set('e1000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'Key Result weights must add up to 100 for objective "Incomplete weights"',
  'publishing rejects a set when another Objective has incomplete KR weights'
);
delete from public.okr_objectives where id = 'f1000000-0000-0000-0000-000000000003';
select is((select count(*)::integer from public.okr_versions), 2, 'publishing after equalizing defaults creates another version');
select is(
  jsonb_array_length((
    select snapshot -> 'objectives'
    from public.okr_versions
    where set_id = 'e1000000-0000-0000-0000-000000000001' and version = 1
  )),
  1,
  'the first published version contains the complete objective snapshot'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_sets), 1, 'workspace members see a published public set');
select is((select count(*)::integer from public.okr_objectives), 1, 'an objective inherits public set visibility');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.okr_sets set visibility = 'restricted' where id = 'e1000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_sets), 0, 'a restricted set is hidden from members without a grant');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.okr_set_group_acl(set_id, workspace_id, group_id) values
  ('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_sets), 1, 'a user-group grant exposes the restricted set');
select is((select count(*)::integer from public.okr_set_group_acl), 0, 'permission subject lists remain private to the OKR owner');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_sets), 0, 'a group grant does not expose the set to other members');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.okr_objectives set visibility = 'workspace' where id = 'f1000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_sets), 1, 'an objective-level workspace override makes its owner discoverable');
select is((select count(*)::integer from public.okr_objectives), 1, 'an objective-level workspace override is effective');
select is((select count(*)::integer from public.okr_access_revisions), 1, 'all members can receive a generic access revision for realtime cache invalidation');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
delete from public.okr_set_group_acl where set_id = 'e1000000-0000-0000-0000-000000000001';
update public.okr_objectives set visibility = 'restricted' where id = 'f1000000-0000-0000-0000-000000000001';
insert into public.okr_objective_user_acl(objective_id, workspace_id, user_id) values
  ('f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_objectives), 1, 'a direct member grant overrides the set restriction');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_objectives), 0, 'an objective restriction hides inherited content from other members');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.okr_key_results set visibility = 'workspace' where id = 'f2000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.okr_sets), 1, 'a KR override keeps its employee visible');
select is((select count(*)::integer from public.okr_objectives), 1, 'a visible KR exposes the required parent objective shell');
select is((select count(*)::integer from public.okr_key_results), 1, 'a KR-level workspace override is effective');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.okr_objective_user_acl(objective_id, workspace_id, user_id) values (
    'f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005'
  )$$,
  '23503', null,
  'an ACL cannot grant access to a user outside the workspace'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$update public.okr_objectives set title = 'Admin edit' where id = 'f1000000-0000-0000-0000-000000000001' returning title$$,
  $$select null::text where false$$,
  'workspace admins cannot edit another member OKR'
);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$update public.okr_objectives set title = 'Responsible edit' where id = 'f1000000-0000-0000-0000-000000000001' returning title$$,
  $$select null::text where false$$,
  'display responsibles cannot edit the OKR'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$update public.okr_objectives set title = 'Owner edit' where id = 'f1000000-0000-0000-0000-000000000001'$$,
  'the OKR owner can edit their active-cycle content'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$update public.okr_cycles set status = 'closed' where id = 'd1000000-0000-0000-0000-000000000001'$$,
  'an admin can close a cycle'
);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$update public.okr_objectives set title = 'Closed edit' where id = 'f1000000-0000-0000-0000-000000000001' returning title$$,
  $$select null::text where false$$,
  'a closed cycle is read-only even for the OKR owner'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.okr_cycles(workspace_id, name, starts_on, ends_on, created_by) values (
    'b1000000-0000-0000-0000-000000000001', 'Forbidden cycle', '2027-01-01', '2027-03-31', 'a1000000-0000-0000-0000-000000000003'
  )$$,
  '42501', null,
  'regular members cannot create cycles'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$update public.okr_cycles set status = 'active' where id = 'd1000000-0000-0000-0000-000000000001'$$,
  'an admin can reopen a cycle'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.update_okr_key_result_progress(
    'f2000000-0000-0000-0000-000000000001', 45, 'risk', 'On track after mitigation'
  )$$,
  'the owner can append a progress update'
);
select is((select count(*)::integer from public.okr_progress_records), 1, 'progress updates append an immutable record');
select throws_ok(
  $$update public.okr_progress_records set detail = 'rewritten'$$,
  '42501', null,
  'progress records cannot be modified'
);
select throws_ok(
  $$update public.okr_versions set snapshot = '{}'::jsonb$$,
  '42501', null,
  'published versions cannot be modified'
);
select lives_ok(
  $$select public.publish_okr_set('e1000000-0000-0000-0000-000000000001')$$,
  'the owner can publish a later version'
);
select is((select max(version)::integer from public.okr_versions), 3, 'version numbers increase on every publish');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.okr_cycles where id = 'd1000000-0000-0000-0000-000000000002'),
  0,
  'draft cycles are hidden from regular members'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.okr_cycles(workspace_id, name, starts_on, ends_on, created_by) values (
    'b1000000-0000-0000-0000-000000000001', 'Admin cycle', '2027-01-01', '2027-03-31', 'a1000000-0000-0000-0000-000000000002'
  )$$,
  'workspace admins can create cycles'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.create_okr_key_result_with_balanced_weights(
    'f1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'Retain 80 percent of active teams',
    1,
    array['f2000000-0000-0000-0000-000000000001'::uuid],
    array[50::numeric],
    50
  )$$,
  'adding a Key Result and rebalancing existing weights is atomic'
);
select is(
  (select weight from public.okr_key_results where id = 'f2000000-0000-0000-0000-000000000001'),
  50::numeric,
  'the combined mutation updates existing Key Result weights'
);
select is(
  (select count(*)::integer from public.okr_key_results where objective_id = 'f1000000-0000-0000-0000-000000000001'),
  2,
  'the combined mutation inserts exactly one Key Result'
);
select is(
  jsonb_array_length(public.load_okr_set(
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  ) -> 'objectives'),
  1,
  'the consolidated OKR loader returns objectives in one result'
);
select is(
  jsonb_array_length(public.load_okr_set(
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  ) #> '{objectives,0,key_results}'),
  2,
  'the consolidated OKR loader includes nested Key Results'
);
select ok(
  public.load_okr_set(
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  ) #> '{objectives,0,responsible_ids}' =
    '["a1000000-0000-0000-0000-000000000003"]'::jsonb,
  'the consolidated OKR loader includes nested relationship ids'
);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.okr_key_results
set weight = 40
where objective_id = 'f1000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.publish_okr_set('e1000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'Key Result weights must add up to 100 for objective "Owner edit"',
  'custom Key Result weights that do not sum to 100 are still rejected'
);

update public.okr_key_results
set weight = 50
where objective_id = 'f1000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(
  public.load_okr_set(
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001'
  ),
  null::jsonb,
  'the consolidated OKR loader preserves RLS for outsiders'
);

select * from finish();
rollback;
