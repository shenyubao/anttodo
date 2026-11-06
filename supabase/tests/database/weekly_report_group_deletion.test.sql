begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('aa100000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated','weekly-delete-'||i||'@example.test','',now(),'{}','{}',now(),now()
from generate_series(1,5) i;
insert into public.workspaces(id,name,created_by) values
 ('bb100000-0000-0000-0000-000000000001','Deletion team','aa100000-0000-0000-0000-000000000001'),
 ('bb100000-0000-0000-0000-000000000002','Outside','aa100000-0000-0000-0000-000000000005');
insert into public.workspace_members(workspace_id,user_id,role)
select 'bb100000-0000-0000-0000-000000000001',('aa100000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 case when i=2 then 'admin'::public.workspace_role else 'member'::public.workspace_role end from generate_series(2,4) i;
insert into public.weekly_report_groups(id,workspace_id,name,participant_ids) values
 ('cc100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','Delete me','{aa100000-0000-0000-0000-000000000003}'),
 ('cc100000-0000-0000-0000-000000000002','bb100000-0000-0000-0000-000000000001','Keep me','{aa100000-0000-0000-0000-000000000003}');
insert into public.weekly_reports(id,workspace_id,weekly_report_group_id,author_id,week_start,completed_text,status,published_at,notification_revision) values
 ('dd100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001','aa100000-0000-0000-0000-000000000003',date_trunc('week',current_date)::date,'Published','published',now(),1),
 ('dd100000-0000-0000-0000-000000000002','bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001','aa100000-0000-0000-0000-000000000004',date_trunc('week',current_date)::date,'Draft','draft',null,0),
 ('dd100000-0000-0000-0000-000000000003','bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000002','aa100000-0000-0000-0000-000000000003',date_trunc('week',current_date)::date,'Keep','published',now(),0);
insert into public.user_groups(id,workspace_id,name,created_by) values
 ('ff100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','Shared viewers','aa100000-0000-0000-0000-000000000001');
insert into public.weekly_report_user_acl(report_id,workspace_id,user_id) values
 ('dd100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','aa100000-0000-0000-0000-000000000004');
insert into public.weekly_report_group_acl(report_id,workspace_id,group_id) values
 ('dd100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','ff100000-0000-0000-0000-000000000001');
insert into public.weekly_report_notification_groups(id,workspace_id,name,type,credential_secret_id) values
 ('ee100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','Shared target','dingtalk',vault.create_secret('{}'));
insert into public.weekly_report_notification_targets(report_id,workspace_id,author_id,notification_group_id) values
 ('dd100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','aa100000-0000-0000-0000-000000000003','ee100000-0000-0000-0000-000000000001');
insert into public.weekly_report_notification_deliveries(report_id,workspace_id,author_id,notification_group_id,revision) values
 ('dd100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','aa100000-0000-0000-0000-000000000003','ee100000-0000-0000-0000-000000000001',1);
insert into anttodo_private.weekly_report_reminder_deliveries(workspace_id,weekly_report_group_id,notification_group_id,week_start,scheduled_for) values
 ('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001','ee100000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aa100000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001')$$,'42501',null,'participant cannot invoke deletion');
select results_eq($$delete from public.weekly_report_groups where id='cc100000-0000-0000-0000-000000000001' returning id$$,$$select null::uuid where false$$,'participant cannot directly delete a group');
select set_config('request.jwt.claims','{"sub":"aa100000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001')$$,'42501',null,'viewer cannot delete a group');
select set_config('request.jwt.claims','{"sub":"aa100000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001')$$,'42501',null,'outside owner cannot delete another workspace group');
select throws_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000002','cc100000-0000-0000-0000-000000000001')$$,'42501',null,'workspace ID cannot be forged to bypass deletion permissions');
select set_config('request.jwt.claims','{"sub":"aa100000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is(public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001'),'cc100000-0000-0000-0000-000000000001'::uuid,'admin can delete another author group');
reset role;
select is((select count(*)::int from public.weekly_report_groups where id='cc100000-0000-0000-0000-000000000001'),0,'group is permanently deleted');
select is((select count(*)::int from public.weekly_reports where weekly_report_group_id='cc100000-0000-0000-0000-000000000001'),0,'published reports and other authors drafts are deleted');
select is((select count(*)::int from public.weekly_report_user_acl where report_id='dd100000-0000-0000-0000-000000000001'),0,'report user ACL is deleted');
select is((select count(*)::int from public.weekly_report_group_acl where report_id='dd100000-0000-0000-0000-000000000001'),0,'report group ACL is deleted');
select is((select count(*)::int from public.weekly_report_notification_targets where report_id='dd100000-0000-0000-0000-000000000001'),0,'report notification targets are deleted');
select is((select count(*)::int from public.weekly_report_notification_deliveries where report_id='dd100000-0000-0000-0000-000000000001'),0,'report notification deliveries are deleted');
select is((select count(*)::int from anttodo_private.weekly_report_reminder_deliveries where weekly_report_group_id='cc100000-0000-0000-0000-000000000001'),0,'group reminder queue is deleted');
select is((select count(*)::int from public.weekly_reports where id='dd100000-0000-0000-0000-000000000003'),1,'another group report is retained');
select is((select count(*)::int from public.user_groups where id='ff100000-0000-0000-0000-000000000001'),1,'shared user groups are retained');
select is((select count(*)::int from public.weekly_report_notification_groups where id='ee100000-0000-0000-0000-000000000001'),1,'shared notification group and credentials are retained');
select ok(exists(select 1 from vault.secrets where id=(select credential_secret_id from public.weekly_report_notification_groups where id='ee100000-0000-0000-0000-000000000001')),'shared Vault credentials are retained');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aa100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001')$$,'42501',null,'already deleted groups produce a clear failure');
select lives_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001',(select id from public.weekly_report_groups where workspace_id='bb100000-0000-0000-0000-000000000001' and is_default))$$,'owner can delete the default group');
select is(anttodo_private.default_weekly_report_group('bb100000-0000-0000-0000-000000000001'),'cc100000-0000-0000-0000-000000000002'::uuid,'legacy default resolves to the surviving group');
select is((public.get_weekly_report_configuration('bb100000-0000-0000-0000-000000000001')->'participant_ids')::text,'["aa100000-0000-0000-0000-000000000003"]','legacy configuration reads the fallback group');
select lives_ok($$select public.save_weekly_report_participants('bb100000-0000-0000-0000-000000000001','{aa100000-0000-0000-0000-000000000001}')$$,'legacy participant writes target fallback');
select is((select participant_ids::text from public.weekly_report_groups where id='cc100000-0000-0000-0000-000000000002'),'{aa100000-0000-0000-0000-000000000001}','legacy roster was written to fallback');
select lives_ok($$select public.save_weekly_report_reminders('bb100000-0000-0000-0000-000000000001',false,'[]','{}')$$,'legacy reminder writes target fallback');
select ok(anttodo_private.can_write_weekly_report('bb100000-0000-0000-0000-000000000001'),'legacy permission check follows surviving roster');
select lives_ok($$select public.save_weekly_report('bb100000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Legacy report after default deletion','','','workspace')$$,'legacy report save works after default deletion');
select lives_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000002')$$,'last group can be deleted');
select is((select count(*)::int from public.list_weekly_report_groups('bb100000-0000-0000-0000-000000000001')),0,'group list becomes empty');
select is(anttodo_private.default_weekly_report_group('bb100000-0000-0000-0000-000000000001'),null::uuid,'empty workspace has no fallback');
select lives_ok($$select public.save_weekly_report_group('bb100000-0000-0000-0000-000000000001','Recreated','{aa100000-0000-0000-0000-000000000001}')$$,'new group can be created after deleting all groups');
select ok(anttodo_private.default_weekly_report_group('bb100000-0000-0000-0000-000000000001') is not null,'new group becomes the legacy fallback');
set local role anon;
select throws_ok($$select public.delete_weekly_report_group('bb100000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000002')$$,'42501',null,'anonymous deletion is denied');
reset role;
select * from finish();
rollback;
