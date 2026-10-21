begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
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

update public.okr_objectives set position=1 where title='Alignment';
update public.profiles set display_name='Viewer' where id='a1000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select public.save_okr_changes('e1000000-0000-0000-0000-000000000001','{"objectives":[]}',true);
select is((select column_default from information_schema.columns where table_schema='public' and table_name='okr_display_preferences' and column_name='show_score'),'false','score defaults off');
select ok('a1000000-0000-0000-0000-000000000003'::uuid = any(public.load_okr_note_mention_candidates('objective','f1000000-0000-0000-0000-000000000001')),'objective: candidates respect visibility');
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "fields": {"note": "**Plan**\n\n- @Viewer follow up"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000003"]}]}')$q$,'objective: save Markdown and mention atomically');
select is((select count(*)::int from public.okr_note_mentions where objective_id='f1000000-0000-0000-0000-000000000001'),1,'objective: mention persisted');
select is((public.load_okr_set('b1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001')#>>'{objectives,0,note_mentions,0,user_id}'),'a1000000-0000-0000-0000-000000000003','objective: mentions load in set payload');
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "fields": {"note": "**Plan**\n\n- @Viewer follow up"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000003"]}]}')$q$,'objective: repeated save succeeds');
reset role;
select is((select count(*)::int from public.notifications where objective_id='f1000000-0000-0000-0000-000000000001'),1,'objective: repeated save does not duplicate notification');
set local role authenticated;
select throws_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "fields": {"note": "unauthorized @Outsider"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000005"]}]}')$q$,'42501','Mention recipient cannot view this OKR','objective: inaccessible recipient rejected');
select alike((select note from public.okr_objectives where id='f1000000-0000-0000-0000-000000000001'),'%@Viewer%','objective: failed save rolls back note');
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "fields": {"note": "No mentions"}, "mentioned_user_ids": []}]}')$q$,'objective: remove mention');
reset role;
select is((select count(*)::int from public.notifications where objective_id='f1000000-0000-0000-0000-000000000001'),0,'objective: removing mention removes notification');
set local role authenticated;
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "fields": {"note": "**Plan**\n\n- @Viewer follow up"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000003"]}]}')$q$,'objective: re-mention sends again');
reset role;
select is((select count(*)::int from public.notifications where objective_id='f1000000-0000-0000-0000-000000000001'),1,'objective: one notification after re-mention');
set local role authenticated;
select ok('a1000000-0000-0000-0000-000000000003'::uuid = any(public.load_okr_note_mention_candidates('key_result','f2000000-0000-0000-0000-000000000001')),'key_result: candidates respect visibility');
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "key_results": [{"id": "f2000000-0000-0000-0000-000000000001", "fields": {"note": "**Plan**\n\n- @Viewer follow up"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000003"]}]}]}')$q$,'key_result: save Markdown and mention atomically');
select is((select count(*)::int from public.okr_note_mentions where key_result_id='f2000000-0000-0000-0000-000000000001'),1,'key_result: mention persisted');
select is((public.load_okr_set('b1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001')#>>'{objectives,0,key_results,0,note_mentions,0,user_id}'),'a1000000-0000-0000-0000-000000000003','key_result: mentions load in set payload');
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "key_results": [{"id": "f2000000-0000-0000-0000-000000000001", "fields": {"note": "**Plan**\n\n- @Viewer follow up"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000003"]}]}]}')$q$,'key_result: repeated save succeeds');
reset role;
select is((select count(*)::int from public.notifications where key_result_id='f2000000-0000-0000-0000-000000000001'),1,'key_result: repeated save does not duplicate notification');
set local role authenticated;
select throws_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "key_results": [{"id": "f2000000-0000-0000-0000-000000000001", "fields": {"note": "unauthorized @Outsider"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000005"]}]}]}')$q$,'42501','Mention recipient cannot view this OKR','key_result: inaccessible recipient rejected');
select alike((select note from public.okr_key_results where id='f2000000-0000-0000-0000-000000000001'),'%@Viewer%','key_result: failed save rolls back note');
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "key_results": [{"id": "f2000000-0000-0000-0000-000000000001", "fields": {"note": "No mentions"}, "mentioned_user_ids": []}]}]}')$q$,'key_result: remove mention');
reset role;
select is((select count(*)::int from public.notifications where key_result_id='f2000000-0000-0000-0000-000000000001'),0,'key_result: removing mention removes notification');
set local role authenticated;
select lives_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001', '{"objectives": [{"id": "f1000000-0000-0000-0000-000000000001", "key_results": [{"id": "f2000000-0000-0000-0000-000000000001", "fields": {"note": "**Plan**\n\n- @Viewer follow up"}, "mentioned_user_ids": ["a1000000-0000-0000-0000-000000000003"]}]}]}')$q$,'key_result: re-mention sends again');
reset role;
select is((select count(*)::int from public.notifications where key_result_id='f2000000-0000-0000-0000-000000000001'),1,'key_result: one notification after re-mention');
set local role authenticated;
select public.save_okr_changes('e1000000-0000-0000-0000-000000000001','{"objectives":[]}',true);
select alike((select snapshot#>>'{objectives,0,keyResults,0,note}' from public.okr_versions order by version desc limit 1),'%@Viewer%','publication snapshot preserves KR Markdown notes');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.notifications where notification_type='okr_mentioned'),2,'recipient sees both O and KR notifications');
select lives_ok($q$update public.notifications set read_at=now() where notification_type='okr_mentioned'$q$,'recipient can mark OKR notifications read');
select throws_ok($q$select public.save_okr_changes('e1000000-0000-0000-0000-000000000001','{"objectives":[]}'::jsonb)$q$,'42501','Only the OKR owner can edit an active cycle','viewer cannot edit notes');
reset role;
update public.okr_objectives set visibility='restricted' where set_id='e1000000-0000-0000-0000-000000000001';
update public.okr_key_results set visibility='restricted' where objective_id='f1000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*)::int from public.notifications where notification_type='okr_mentioned'),0,'revoked access hides OKR notifications');
select is((select count(*)::int from public.okr_note_mentions),0,'revoked access hides mention records');
reset role;
select ok(not has_table_privilege('authenticated','public.okr_note_mentions','insert'),'clients cannot forge mention records');
select ok(not has_function_privilege('anon','public.load_okr_note_mention_candidates(text,uuid)','execute'),'anonymous cannot load candidates');
select * from finish();
rollback;
