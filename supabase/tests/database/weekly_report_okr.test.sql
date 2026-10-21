begin;

create extension if not exists pgtap with schema extensions;
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


insert into public.okr_sets(id, workspace_id, cycle_id, owner_id, published_at) values
 ('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', now());
insert into public.okr_objectives(id, set_id, workspace_id, title, published_at, current_value) values
 ('f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Objective', now(), 12);
insert into public.okr_key_results(id, objective_id, workspace_id, title, published_at) values
 ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Key Result', now());
-- An existing O record from before this migration remains readable.
alter table public.okr_progress_records disable trigger okr_progress_records_key_results_only;
insert into public.okr_progress_records(objective_id, workspace_id, actor_id, current_status, detail) values
 ('f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'normal', 'Historical O record');
alter table public.okr_progress_records enable trigger okr_progress_records_key_results_only;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select progress_mode::text from public.okr_objectives limit 1), 'key_results', 'new objectives default to KR aggregation');
select throws_ok($$update public.okr_objectives set progress_mode = 'manual'$$, '23514', null, 'manual progress mode is rejected');
select lives_ok($$select public.update_okr_objective_progress('f1000000-0000-0000-0000-000000000001', 99, 'risk', '')$$, 'legacy status-only calls remain compatible');
select is((select current_value from public.okr_objectives limit 1), 12::numeric, 'legacy supplied O progress is ignored');
select is((select progress_status::text from public.okr_objectives limit 1), 'risk', 'O status still updates');
select is((select count(*)::int from public.okr_progress_records), 1, 'status-only updates do not add O records');
select throws_ok($$select public.update_okr_objective_progress('f1000000-0000-0000-0000-000000000001', 99, 'normal', 'New O record')$$, '23514', null, 'new O records are rejected by legacy RPC');
select throws_ok($$insert into public.okr_progress_records(objective_id, workspace_id, actor_id, current_status, detail) values
 ('f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'normal', 'New O record')$$, '23514', null, 'direct inserts cannot add O records');
select lives_ok($$select public.update_okr_key_result_progress('f2000000-0000-0000-0000-000000000001', 50, 'normal', 'KR update')$$, 'KR progress updates remain writable');
select is((select count(*)::int from public.okr_progress_records), 2, 'KR writes append history');
select is((select detail from public.okr_progress_records where objective_id is not null), 'Historical O record', 'historical O detail is preserved');

select lives_ok($$select public.save_weekly_report(
 p_workspace_id=>'b1000000-0000-0000-0000-000000000001', p_week_start=>date_trunc('week',current_date)::date,
 p_completed_text=>'', p_next_plan_text=>'', p_reflection_text=>'', p_visibility=>'workspace', p_publish=>true,
 p_okr_progress_text=>'- Objective 10%->50%')$$, 'OKR-only reports can be published');
select is((select okr_progress_text from public.weekly_reports limit 1), '- Objective 10%->50%', 'generated text is stored');
select lives_ok($$select public.save_weekly_report(
 'b1000000-0000-0000-0000-000000000001', date_trunc('week',current_date)::date, '', '', '', 'workspace')$$, 'old clients can save OKR-only reports');
select is((select okr_progress_text from public.weekly_reports limit 1), '- Objective 10%->50%', 'omitted argument preserves content');
select is((select notification_revision from public.weekly_reports limit 1), 1::bigint, 'unchanged save does not bump notification revision');
select lives_ok($$select public.save_weekly_report(
 p_workspace_id=>'b1000000-0000-0000-0000-000000000001', p_week_start=>date_trunc('week',current_date)::date,
 p_completed_text=>'', p_next_plan_text=>'', p_reflection_text=>'', p_visibility=>'workspace',
 p_okr_progress_text=>'- Updated Objective')$$, 'OKR changes save on published reports');
select is((select notification_revision from public.weekly_reports limit 1), 2::bigint, 'OKR changes bump notification revision');
select throws_ok($$select public.save_weekly_report(
 p_workspace_id=>'b1000000-0000-0000-0000-000000000001', p_week_start=>date_trunc('week',current_date)::date,
 p_completed_text=>'', p_next_plan_text=>'', p_reflection_text=>'', p_visibility=>'workspace',
 p_okr_progress_text=>'')$$, '23514', null, 'clearing the only published content is rejected');
select lives_ok($$select public.save_weekly_report(
 p_workspace_id=>'b1000000-0000-0000-0000-000000000001', p_week_start=>date_trunc('week',current_date)::date,
 p_completed_text=>'Other content', p_next_plan_text=>'', p_reflection_text=>'', p_visibility=>'workspace',
 p_okr_progress_text=>'')$$, 'explicit empty string clears OKR content when another section exists');
select is((select okr_progress_text from public.weekly_reports limit 1), '', 'explicit empty string is not treated as omitted');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.weekly_reports), 0, 'OKR report content follows weekly report RLS');
select is((select count(*)::int from public.okr_progress_records), 0, 'progress history follows OKR RLS');
select * from finish();
rollback;
