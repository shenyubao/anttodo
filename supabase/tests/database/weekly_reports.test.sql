begin;

create extension if not exists pgtap with schema extensions;
select plan(65);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('aa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'report-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('aa000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'report-admin@example.com', '', now(), '{}', '{}', now(), now()),
  ('aa000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'report-user@example.com', '', now(), '{}', '{}', now(), now()),
  ('aa000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'report-group@example.com', '', now(), '{}', '{}', now(), now()),
  ('aa000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'report-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by) values
  ('bb000000-0000-0000-0000-000000000001', 'Weekly reports', 'aa000000-0000-0000-0000-000000000001'),
  ('bb000000-0000-0000-0000-000000000002', 'Other workspace', 'aa000000-0000-0000-0000-000000000005');
insert into public.workspace_members(workspace_id, user_id, role) values
  ('bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'admin'),
  ('bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000003', 'member'),
  ('bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000004', 'member');
-- These fixtures explicitly opt existing test authors into the workspace roster.
update public.weekly_report_groups set participant_ids=(select array_agg(user_id) from public.workspace_members
where workspace_id='bb000000-0000-0000-0000-000000000001') where workspace_id='bb000000-0000-0000-0000-000000000001';
insert into public.user_groups(id, workspace_id, name, created_by) values
  ('cc000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'Readers', 'aa000000-0000-0000-0000-000000000001');
insert into public.user_group_members(group_id, workspace_id, user_id) values
  ('cc000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000004');

select has_table('public', 'weekly_reports', 'weekly reports table exists');
select has_table('public', 'weekly_report_user_acl', 'weekly report user ACL exists');
select has_table('public', 'weekly_report_group_acl', 'weekly report group ACL exists');
select ok((select relrowsecurity from pg_class where oid = 'public.weekly_reports'::regclass), 'weekly reports RLS is enabled');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.save_weekly_report(
    'bb000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date, '', '', '', 'workspace'
  )$$,
  'author can save an empty draft'
);
select is((select status from public.weekly_reports limit 1), 'draft'::public.weekly_report_status, 'save creates a draft');
select throws_ok(
  $$select public.save_weekly_report(
    'bb000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date, '', '', '', 'workspace', '{}', '{}', null, true
  )$$,
  '23514', null, 'an empty report cannot be published'
);

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_reports), 0, 'drafts are private');

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.save_weekly_report(
    'bb000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date, '完成发布', '', '', 'workspace', '{}', '{}', null, true
  )$$,
  'author can publish a workspace report'
);
select is((select count(*)::integer from public.weekly_reports), 1, 'saving the same week updates instead of duplicating');
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_reports), 1, 'workspace members see published workspace reports');

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.save_weekly_report(
    'bb000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date, '完成发布', '', '', 'users',
    array['aa000000-0000-0000-0000-000000000003'::uuid], '{}', null, false
  )$$,
  'legacy user audience arguments remain compatible'
);
select is((select count(*)::integer from public.weekly_report_user_acl), 0, 'legacy per-report audience is superseded by the group');
select is((select count(*)::integer from public.weekly_report_group_acl), 0, 'opposite ACL is empty');
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_reports), 1, 'selected user can read the report');
select is((select count(*)::integer from public.weekly_report_user_acl), 0, 'ACL subjects remain private to author');
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_reports), 1, 'group audience replaces legacy per-report audience');

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.save_weekly_report(
    'bb000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date, '完成发布', '', '', 'groups', '{}',
    array['cc000000-0000-0000-0000-000000000001'::uuid], null, false
  )$$,
  'legacy user-group audience arguments remain compatible'
);
select is((select count(*)::integer from public.weekly_report_user_acl), 0, 'switching scope clears user ACL');
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_reports), 1, 'group member can read the report');

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$update public.weekly_reports set completed_text = 'Admin edit' returning completed_text$$,
  $$select null::text where false$$,
  'workspace admin cannot edit another author report'
);
select results_eq(
  $$delete from public.weekly_reports returning id$$,
  $$select null::uuid where false$$,
  'workspace admin cannot delete another author report'
);

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_reports), 0, 'workspace outsider cannot read reports');
select throws_ok(
  $$insert into public.weekly_reports(workspace_id, author_id, week_start) values (
    'bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000005', date_trunc('week', current_date)::date
  )$$,
  '42501', null, 'workspace outsider cannot create reports'
);

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.weekly_reports(workspace_id, author_id, week_start) values (
    'bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date + 1
  )$$,
  '23514', null, 'week start must be Monday'
);
select throws_ok(
  $$select public.save_weekly_report(
    'bb000000-0000-0000-0000-000000000001', date_trunc('week', current_date)::date - 14,
    '历史周报', '', '', 'workspace'
  )$$,
  '23514', null, 'reports older than last week cannot be created'
);
select is((select count(*)::integer from public.weekly_report_access_revisions), 1, 'workspace access revision is available');

select has_table('public', 'weekly_report_notification_groups', 'weekly report notification groups table exists');
select has_table('public', 'weekly_report_notification_targets', 'weekly report notification targets table exists');
select has_table('public', 'weekly_report_notification_deliveries', 'weekly report notification deliveries table exists');
select has_column('public', 'weekly_reports', 'notification_revision', 'weekly reports track notification revision');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.weekly_report_notification_groups'::regclass),
  'notification groups RLS is enabled'
);

reset role;
select lives_ok(
  $$select public.create_weekly_report_notification_group(
    'bb000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    'dingtalk', 'Owner robot',
    '{"webhook":"https://oapi.dingtalk.com/robot/send?access_token=owner","signingSecret":"SEC-owner"}'::jsonb
  )$$,
  'service role can create a team notification group with Vault credentials'
);
select lives_ok(
  $$select public.create_weekly_report_notification_group(
    'bb000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dingtalk', 'Admin robot',
    '{"webhook":"https://oapi.dingtalk.com/robot/send?access_token=admin","signingSecret":"SEC-admin"}'::jsonb
  )$$,
  'service role can create another team notification group'
);
select is(
  (select count(*)::integer from vault.secrets where name like 'anttodo_weekly_report_notification_group_%'),
  2,
  'notification group credentials are stored in Vault'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_report_notification_groups), 2, 'workspace members see all team notification groups');
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_report_notification_groups), 2, 'other members also see team notification groups');
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::integer from public.weekly_report_notification_groups), 0, 'workspace outsider cannot see notification groups');

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.save_weekly_report(
    p_workspace_id => 'bb000000-0000-0000-0000-000000000001',
    p_week_start => date_trunc('week', current_date)::date,
    p_completed_text => '完成发布', p_next_plan_text => '', p_reflection_text => '',
    p_visibility => 'groups',
    p_group_ids => array['cc000000-0000-0000-0000-000000000001'::uuid],
    p_notification_group_ids => array[(
      select id from public.weekly_report_notification_groups where name = 'Admin robot'
    )]
  )$$,
  'published report can select a team notification group created by another member'
);
select is((select notification_revision from public.weekly_reports limit 1), 2::bigint, 'adding a target increments the notification revision');
select is((select count(*)::integer from public.weekly_report_notification_targets), 1, 'notification target is saved');
select is((select count(*)::integer from public.weekly_report_notification_deliveries), 1, 'published update creates one delivery');
select is((select status from public.weekly_report_notification_deliveries limit 1), 'pending'::public.weekly_report_notification_delivery_status, 'new delivery is pending');

select lives_ok(
  $$select public.save_weekly_report(
    p_workspace_id => 'bb000000-0000-0000-0000-000000000001',
    p_week_start => date_trunc('week', current_date)::date,
    p_completed_text => '完成发布', p_next_plan_text => '', p_reflection_text => '',
    p_visibility => 'groups',
    p_group_ids => array['cc000000-0000-0000-0000-000000000001'::uuid],
    p_notification_group_ids => array[(
      select id from public.weekly_report_notification_groups where name = 'Admin robot'
    )]
  )$$,
  'saving an unchanged published report succeeds'
);
select is((select notification_revision from public.weekly_reports limit 1), 2::bigint, 'unchanged save does not increment notification revision');
select is((select count(*)::integer from public.weekly_report_notification_deliveries), 1, 'unchanged save does not duplicate delivery');

select lives_ok(
  $$select public.save_weekly_report(
    p_workspace_id => 'bb000000-0000-0000-0000-000000000001',
    p_week_start => date_trunc('week', current_date)::date,
    p_completed_text => '完成发布更新', p_next_plan_text => '', p_reflection_text => '',
    p_visibility => 'groups',
    p_group_ids => array['cc000000-0000-0000-0000-000000000001'::uuid],
    p_notification_group_ids => array[(
      select id from public.weekly_report_notification_groups where name = 'Admin robot'
    )]
  )$$,
  'changing a published report creates a new notification revision'
);
select is((select notification_revision from public.weekly_reports limit 1), 3::bigint, 'changed report increments notification revision');
select is((select count(*)::integer from public.weekly_report_notification_deliveries), 2, 'changed report creates a second delivery');
select is(
  (select status from public.weekly_report_notification_deliveries where revision = 2),
  'superseded'::public.weekly_report_notification_delivery_status,
  'old retryable delivery is superseded'
);
select is(
  (select status from public.weekly_report_notification_deliveries where revision = 3),
  'pending'::public.weekly_report_notification_delivery_status,
  'latest delivery remains pending'
);
select throws_ok(
  $$select public.save_weekly_report(
    p_workspace_id => 'bb000000-0000-0000-0000-000000000001',
    p_week_start => date_trunc('week', current_date)::date,
    p_completed_text => '非法通知群', p_next_plan_text => '', p_reflection_text => '',
    p_visibility => 'workspace',
    p_notification_group_ids => array['dd000000-0000-0000-0000-000000000001'::uuid]
  )$$,
  '42501', null, 'author cannot select a missing notification group'
);

select throws_ok(
  $$select * from public.claim_weekly_report_notification_deliveries(
    (select id from public.weekly_reports limit 1), 3,
    'aa000000-0000-0000-0000-000000000001', false
  )$$,
  '42501', null, 'notification dispatch claim is not callable by authenticated users'
);

reset role;
select is(
  (select count(*)::integer from public.claim_weekly_report_notification_deliveries(
    (select id from public.weekly_reports limit 1), 3,
    'aa000000-0000-0000-0000-000000000001', false
  )),
  1,
  'service role claims the latest pending delivery'
);
select is(
  (select status from public.weekly_report_notification_deliveries where revision = 3),
  'sending'::public.weekly_report_notification_delivery_status,
  'claim marks the delivery as sending'
);
select is(
  (select count(*)::integer from public.claim_weekly_report_notification_deliveries(
    (select id from public.weekly_reports limit 1), 3,
    'aa000000-0000-0000-0000-000000000001', false
  )),
  0,
  'a concurrent normal dispatch cannot claim the same delivery twice'
);
update public.weekly_report_notification_deliveries
set status = 'failed' where revision = 3;
select is(
  (select count(*)::integer from public.claim_weekly_report_notification_deliveries(
    (select id from public.weekly_reports limit 1), 3,
    'aa000000-0000-0000-0000-000000000001', true
  )),
  1,
  'manual retry claims the failed latest delivery'
);
select is(
  (select attempts from public.weekly_report_notification_deliveries where revision = 3),
  2,
  'manual retry increments the attempt count'
);

select throws_ok(
  $$select public.delete_weekly_report_notification_group(
    (select id from public.weekly_report_notification_groups where name = 'Admin robot'),
    'aa000000-0000-0000-0000-000000000005'
  )$$,
  '42501', null, 'workspace outsider cannot delete a team notification group'
);
select lives_ok(
  $$select public.delete_weekly_report_notification_group(
    (select id from public.weekly_report_notification_groups where name = 'Admin robot'),
    'aa000000-0000-0000-0000-000000000001'
  )$$,
  'workspace members can delete a team notification group they did not create'
);
select is(
  (select count(*)::integer from vault.secrets where name like 'anttodo_weekly_report_notification_group_%'),
  1,
  'deleting a notification group removes its Vault credential'
);
select is((select count(*)::integer from public.weekly_report_notification_targets), 0, 'deleting a group clears saved targets');
select is((select count(*)::integer from public.weekly_report_notification_deliveries), 0, 'deleting a group clears its delivery history');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$delete from public.weekly_reports$$, 'author can permanently delete own report');
select is((select count(*)::integer from public.weekly_reports), 0, 'deleted report is gone');

select * from finish();
rollback;
