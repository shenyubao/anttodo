begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('ac000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'weekly-config-' || i || '@example.com', '', now(), '{}', '{}', now(), now()
from generate_series(1,4) i;
insert into public.workspaces(id,name,created_by) values
  ('bc000000-0000-0000-0000-000000000001','Reminder team','ac000000-0000-0000-0000-000000000001'),
  ('bc000000-0000-0000-0000-000000000002','Other team','ac000000-0000-0000-0000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
  ('bc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000002','admin'),
  ('bc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000003','member');
select is((select cardinality(participant_ids) from public.weekly_report_groups where workspace_id='bc000000-0000-0000-0000-000000000001'),1,'new workspace includes only creator; invitations do not auto opt in');
select is((select enabled from public.weekly_report_groups where workspace_id='bc000000-0000-0000-0000-000000000001'),false,'reminders default off');
insert into public.weekly_report_notification_groups(id, workspace_id, type, name, credential_secret_id) values
  ('ec000000-0000-0000-0000-000000000001','bc000000-0000-0000-0000-000000000001','dingtalk','Group A',vault.create_secret('{"webhook":"https://oapi.dingtalk.com/robot/send?access_token=test","signingSecret":"test"}')),
  ('ec000000-0000-0000-0000-000000000002','bc000000-0000-0000-0000-000000000001','dingtalk','Group B',vault.create_secret('{"webhook":"https://oapi.dingtalk.com/robot/send?access_token=test","signingSecret":"test"}')),
  ('ec000000-0000-0000-0000-000000000003','bc000000-0000-0000-0000-000000000002','dingtalk','Other group',vault.create_secret('{}'));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select ok(public.get_weekly_report_configuration('bc000000-0000-0000-0000-000000000001') is not null,'members can read configuration');
select is(public.get_weekly_report_configuration('bc000000-0000-0000-0000-000000000002'),null::jsonb,'other workspace configuration is hidden');
select throws_ok($$select public.save_weekly_report_participants('bc000000-0000-0000-0000-000000000001','{}')$$,'42501',null,'member cannot edit roster');
select throws_ok($$select public.save_weekly_report_reminders('bc000000-0000-0000-0000-000000000001',false,'[]','{}')$$,'42501',null,'member cannot edit reminders');
select throws_ok($$select public.claim_weekly_report_reminders()$$,'42501',null,'members cannot claim credentials or dispatch');
select throws_ok($$select public.save_weekly_report('bc000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'draft','','','workspace')$$,'42501',null,'unlisted member cannot save through RPC');
select throws_ok($$insert into public.weekly_reports(workspace_id,author_id,week_start) values ('bc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000003',date_trunc('week',current_date)::date)$$,'42501',null,'unlisted member cannot bypass with direct insert');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.save_weekly_report_participants('bc000000-0000-0000-0000-000000000001',array['ac000000-0000-0000-0000-000000000004']::uuid[])$$,'23514',null,'roster rejects cross-workspace user');
select lives_ok($$select public.save_weekly_report_participants('bc000000-0000-0000-0000-000000000001',array['ac000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000003']::uuid[])$$,'admin can select roster');
select throws_ok($$select public.save_weekly_report_reminders('bc000000-0000-0000-0000-000000000001',true,'[{"day":5,"time":"18:00"}]',array['ec000000-0000-0000-0000-000000000003']::uuid[])$$,'23514',null,'reminder rejects other workspace group');
select throws_ok($$select public.save_weekly_report_reminders('bc000000-0000-0000-0000-000000000001',true,'[{"day":8,"time":"25:00"}]','{}')$$,'23514',null,'invalid weekday and time rejected');
select throws_ok($$select public.save_weekly_report_reminders('bc000000-0000-0000-0000-000000000001',true,'[]','{}')$$,'23514',null,'enabled requires schedules and groups');
select lives_ok($$select public.save_weekly_report_reminders('bc000000-0000-0000-0000-000000000001',true,'[{"day":5,"time":"18:00"},{"day":7,"time":"20:00"},{"day":5,"time":"18:00"}]',array['ec000000-0000-0000-0000-000000000001','ec000000-0000-0000-0000-000000000002']::uuid[])$$,'admin configures recurring times sharing two groups');
select is((select jsonb_array_length(schedules) from public.weekly_report_groups where workspace_id='bc000000-0000-0000-0000-000000000001'),2,'duplicate reminder times deduplicated');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.save_weekly_report('bc000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'draft','','','workspace')$$,'listed member can save draft');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_weekly_report('bc000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'published','','','workspace','{}','{}',null,true)$$,'owner can publish');
reset role;
update public.weekly_report_groups set reminders_updated_at=date_trunc('week',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
  where workspace_id='bc000000-0000-0000-0000-000000000001';
create temp table claims as select * from public.claim_weekly_report_reminders(
  (date_trunc('week',now() at time zone 'Asia/Shanghai') + interval '4 days 18 hours') at time zone 'Asia/Shanghai');
select is((select count(*)::int from claims),2,'Friday 18:00 Beijing claims one delivery per selected group');
select is((select snapshot->>'submitted' from claims limit 1),'1','draft is not counted as submitted');
select is((select snapshot->>'total' from claims limit 1),'2','only roster is counted');
select is((select count(*)::int from public.claim_weekly_report_reminders(
  (date_trunc('week',now() at time zone 'Asia/Shanghai') + interval '4 days 18 hours') at time zone 'Asia/Shanghai')),0,'duplicate dispatcher cannot claim in-flight deliveries');
select public.finish_weekly_report_reminder(delivery_id,claim_token,case when workspace_id is not null then 'failure' end) from claims;
update anttodo_private.weekly_report_reminder_deliveries set updated_at=now()-interval '8 days';
select is((select count(*)::int from public.claim_weekly_report_reminders(
  (date_trunc('week',now() at time zone 'Asia/Shanghai') + interval '4 days 18 hours 2 minutes') at time zone 'Asia/Shanghai')),2,'failed deliveries can retry');
select public.finish_weekly_report_reminder(id,claim_token,null) from anttodo_private.weekly_report_reminder_deliveries;
select is((select count(*)::int from anttodo_private.weekly_report_reminder_deliveries where status='sent' and all_complete),0,'partial progress does not stop future reminders');
-- Publish remaining report without changing its restricted visibility.
update public.weekly_reports set status='published',published_at=now() where author_id='ac000000-0000-0000-0000-000000000003';
truncate claims;
insert into claims select * from public.claim_weekly_report_reminders(
  (date_trunc('week',now() at time zone 'Asia/Shanghai') + interval '6 days 20 hours') at time zone 'Asia/Shanghai');
select is((select count(*)::int from claims),2,'Sunday reminders still fire after partial progress');
select is((select snapshot->>'submitted' from claims limit 1),'2','both published reports count');
select public.finish_weekly_report_reminder(c.delivery_id,c.claim_token,null) from claims c
join anttodo_private.weekly_report_reminder_deliveries d on d.id=c.delivery_id
where d.notification_group_id='ec000000-0000-0000-0000-000000000001';
select public.finish_weekly_report_reminder(c.delivery_id,c.claim_token,'failure') from claims c
join anttodo_private.weekly_report_reminder_deliveries d on d.id=c.delivery_id
where d.notification_group_id='ec000000-0000-0000-0000-000000000002';
update anttodo_private.weekly_report_reminder_deliveries set updated_at=now()-interval '8 days' where status='failed';
select is((select count(*)::int from public.claim_weekly_report_reminders(
  (date_trunc('week',now() at time zone 'Asia/Shanghai') + interval '6 days 20 hours 2 minutes') at time zone 'Asia/Shanghai')),1,'only unsuccessful group retries full completion');
select public.finish_weekly_report_reminder(id,claim_token,null) from anttodo_private.weekly_report_reminder_deliveries where status='sending';
-- Changing roster does not erase this week's successful full-completion stop.
update public.weekly_report_groups set participant_ids=array_append(participant_ids,'ac000000-0000-0000-0000-000000000002'::uuid) where workspace_id='bc000000-0000-0000-0000-000000000001';
update public.weekly_report_groups set schedules=schedules || '[{"day":7,"time":"21:00"}]'::jsonb where workspace_id='bc000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.claim_weekly_report_reminders(
  (date_trunc('week',now() at time zone 'Asia/Shanghai') + interval '6 days 21 hours') at time zone 'Asia/Shanghai')),0,'all later reminders skip even after roster changes');
select is((select count(*)::int from public.claim_weekly_report_reminders(
  (date_trunc('week',now() at time zone 'Asia/Shanghai') + interval '11 days 18 hours') at time zone 'Asia/Shanghai')),2,'next week resets group completion');
-- Removing a listed author keeps reports readable but prevents all writes.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select public.save_weekly_report_participants('bc000000-0000-0000-0000-000000000001',array['ac000000-0000-0000-0000-000000000001']::uuid[]);
select set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_reports where author_id='ac000000-0000-0000-0000-000000000003'),1,'removed author retains read access to historical report');
select results_eq($$update public.weekly_reports set completed_text='bypass' where author_id='ac000000-0000-0000-0000-000000000003' returning id$$,$$select null::uuid where false$$,'removed author cannot directly update report');
select results_eq($$delete from public.weekly_reports where author_id='ac000000-0000-0000-0000-000000000003' returning id$$,$$select null::uuid where false$$,'removed author cannot delete historical report');
select throws_ok($$select public.save_weekly_report('bc000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'draft','','','workspace')$$,'42501',null,'removed author cannot save or republish via RPC');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select public.save_weekly_report_participants('bc000000-0000-0000-0000-000000000001','{}');
select is((select enabled from public.weekly_report_groups where workspace_id='bc000000-0000-0000-0000-000000000001'),false,'empty roster disables reminders');
reset role;
update public.weekly_report_groups set participant_ids=array_append(participant_ids,'ac000000-0000-0000-0000-000000000003'::uuid) where workspace_id='bc000000-0000-0000-0000-000000000001';
delete from public.workspace_members where workspace_id='bc000000-0000-0000-0000-000000000001' and user_id='ac000000-0000-0000-0000-000000000003';
select is((select cardinality(participant_ids) from public.weekly_report_groups where workspace_id='bc000000-0000-0000-0000-000000000001'),0,'leaving workspace removes participant');
select * from finish();
rollback;
