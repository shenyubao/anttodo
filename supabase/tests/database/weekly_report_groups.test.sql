begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('ad000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated','weekly-group-'||i||'@example.com','',now(),'{}','{}',now(),now()
from generate_series(1,6) i;
insert into public.workspaces(id,name,created_by) values
 ('bd000000-0000-0000-0000-000000000001','Group team','ad000000-0000-0000-0000-000000000001'),
 ('bd000000-0000-0000-0000-000000000002','Outside','ad000000-0000-0000-0000-000000000006');
insert into public.workspace_members(workspace_id,user_id,role)
select 'bd000000-0000-0000-0000-000000000001',('ad000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 case when i=2 then 'admin'::public.workspace_role else 'member'::public.workspace_role end from generate_series(2,5) i;
insert into public.user_groups(id,workspace_id,name,created_by) values
 ('cd000000-0000-0000-0000-000000000001','bd000000-0000-0000-0000-000000000001','Readers','ad000000-0000-0000-0000-000000000001');
insert into public.user_group_members(group_id,workspace_id,user_id) values
 ('cd000000-0000-0000-0000-000000000001','bd000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000005');
insert into public.weekly_report_notification_groups(id,workspace_id,type,name,credential_secret_id) values
 ('ed000000-0000-0000-0000-000000000001','bd000000-0000-0000-0000-000000000001','dingtalk','Shared target',vault.create_secret('{}'));
select is((select count(*)::int from public.weekly_report_groups where workspace_id='bd000000-0000-0000-0000-000000000001' and is_default),1,'workspace initializes one default group');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.weekly_group_a',(public.save_weekly_report_group('bd000000-0000-0000-0000-000000000001','  Group A  ',
 array['ad000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000003']::uuid[],
 'selected',array['ad000000-0000-0000-0000-000000000004']::uuid[],array['cd000000-0000-0000-0000-000000000001']::uuid[],
 true,'[{"day":5,"time":"18:00"},{"day":7,"time":"18:00"}]',array['ed000000-0000-0000-0000-000000000001']::uuid[])).id::text,true);
select set_config('test.weekly_group_b',(public.save_weekly_report_group('bd000000-0000-0000-0000-000000000001','Group B',
 array['ad000000-0000-0000-0000-000000000003']::uuid[],'selected','{}','{}',true,
 '[{"day":5,"time":"18:00"},{"day":7,"time":"18:00"}]',array['ed000000-0000-0000-0000-000000000001']::uuid[])).id::text,true);
select is((select name from public.weekly_report_groups where id=current_setting('test.weekly_group_a')::uuid),'Group A','group names are trimmed');
select is((select count(*)::int from public.list_weekly_report_groups('bd000000-0000-0000-0000-000000000001')),3,'owner can manage every group');
select throws_ok($$select public.save_weekly_report_group('bd000000-0000-0000-0000-000000000001','Empty','{}')$$,'23514',null,'new group needs participants');
select throws_ok($$select public.save_weekly_report_group('bd000000-0000-0000-0000-000000000001',' ','{ad000000-0000-0000-0000-000000000001}')$$,'23514',null,'blank group name rejected');
select throws_ok($$select public.save_weekly_report_group('bd000000-0000-0000-0000-000000000001','Outside','{ad000000-0000-0000-0000-000000000006}')$$,'23514',null,'cross-workspace roster rejected');
select throws_ok($$select public.save_weekly_report_group('bd000000-0000-0000-0000-000000000001','Outside viewer','{ad000000-0000-0000-0000-000000000001}','selected','{ad000000-0000-0000-0000-000000000006}')$$,'23514',null,'cross-workspace viewer rejected');
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_report_groups where id in(current_setting('test.weekly_group_a')::uuid,current_setting('test.weekly_group_b')::uuid)),2,'participants automatically see both groups');
select throws_ok($$select public.save_weekly_report_group('bd000000-0000-0000-0000-000000000001','Member created','{ad000000-0000-0000-0000-000000000003}')$$,'42501',null,'ordinary member cannot create groups');
select results_eq($$update public.weekly_report_groups set name='Member changed' where id=current_setting('test.weekly_group_a')::uuid returning id$$,$$select null::uuid where false$$,'ordinary member cannot directly edit groups');
select set_config('test.weekly_report_a',(public.save_group_weekly_report(current_setting('test.weekly_group_a')::uuid,
 'bd000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'A content','','','workspace','{}','{}',null,true)).id::text,true);
select set_config('test.weekly_report_b',(public.save_group_weekly_report(current_setting('test.weekly_group_b')::uuid,
 'bd000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'B draft','','','workspace')).id::text,true);
select is((select count(*)::int from public.weekly_reports where author_id='ad000000-0000-0000-0000-000000000003'),2,'same author independently reports in two groups in the same week');
select lives_ok($$select public.save_group_weekly_report(current_setting('test.weekly_group_a')::uuid,'bd000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'A updated','','','workspace')$$,'second save updates the same group report');
select is((select count(*)::int from public.weekly_reports where author_id='ad000000-0000-0000-0000-000000000003'),2,'same group week does not duplicate');
select throws_ok($$select public.save_group_weekly_report(current_setting('test.weekly_group_a')::uuid,'bd000000-0000-0000-0000-000000000002',date_trunc('week',current_date)::date,'Bypass','','','workspace')$$,'42501',null,'group cannot be used across workspaces');
select throws_ok($$update public.weekly_reports set weekly_report_group_id=current_setting('test.weekly_group_b')::uuid where id=current_setting('test.weekly_report_a')::uuid$$,'23514',null,'report group cannot change');
select throws_ok($$select public.save_group_weekly_report(current_setting('test.weekly_group_b')::uuid,'bd000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Bypass','','','workspace','{}','{}',current_setting('test.weekly_report_a')::uuid)$$,'42501',null,'RPC cannot move a report across groups');
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_report_groups where id=current_setting('test.weekly_group_a')::uuid),1,'explicit viewer can see group A');
select is((select count(*)::int from public.weekly_report_groups where id=current_setting('test.weekly_group_b')::uuid),0,'explicit viewer cannot see unrelated group B');
select is((select count(*)::int from public.weekly_reports),1,'viewer can see published A but not draft B');
select throws_ok($$select public.save_group_weekly_report(current_setting('test.weekly_group_a')::uuid,'bd000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Viewer write','','','workspace')$$,'42501',null,'viewer cannot write');
select throws_ok($$insert into public.weekly_reports(workspace_id,weekly_report_group_id,author_id,week_start) values('bd000000-0000-0000-0000-000000000001',current_setting('test.weekly_group_a')::uuid,'ad000000-0000-0000-0000-000000000004',date_trunc('week',current_date)::date)$$,'42501',null,'direct insert cannot bypass roster');
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_reports),1,'user-group viewer can see A through union audience');
reset role;
delete from public.user_group_members where user_id='ad000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_reports),0,'user-group revocation immediately hides published reports');
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_report_groups),3,'admin can access every group');
select is((select count(*)::int from public.weekly_reports),1,'admin sees published reports but not another author draft');
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select is((select count(*)::int from public.list_weekly_report_groups('bd000000-0000-0000-0000-000000000001')),0,'outside workspace cannot list groups');
select is((select count(*)::int from public.weekly_reports),0,'outside workspace cannot read reports');
reset role;
update public.weekly_report_groups set reminders_updated_at=date_trunc('week',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
 where workspace_id='bd000000-0000-0000-0000-000000000001';
create temp table group_claims as select * from public.claim_weekly_report_reminders(
 (date_trunc('week',now() at time zone 'Asia/Shanghai')+interval '4 days 18 hours') at time zone 'Asia/Shanghai');
select is((select count(*)::int from group_claims),2,'groups sharing one notification target both dispatch');
select is((select snapshot->>'submitted' from group_claims where weekly_report_group_id=current_setting('test.weekly_group_a')::uuid),'1','group A counts only its published report');
select is((select snapshot->>'submitted' from group_claims where weekly_report_group_id=current_setting('test.weekly_group_b')::uuid),'0','group B draft does not count A submission');
select is((select snapshot->>'groupName' from group_claims where weekly_report_group_id=current_setting('test.weekly_group_a')::uuid),'Group A','snapshot includes report group name');
select public.finish_weekly_report_reminder(delivery_id,claim_token,null) from group_claims;
update public.weekly_reports set status='published',published_at=now() where id=current_setting('test.weekly_report_b')::uuid;
truncate group_claims;
insert into group_claims select * from public.claim_weekly_report_reminders(
 (date_trunc('week',now() at time zone 'Asia/Shanghai')+interval '6 days 18 hours') at time zone 'Asia/Shanghai');
select is((select count(*)::int from group_claims),2,'next schedule sends each group independently');
select public.finish_weekly_report_reminder(delivery_id,claim_token,null) from group_claims;
update public.weekly_report_groups set schedules=schedules || '[{"day":7,"time":"19:00"}]'::jsonb,
 reminders_updated_at=date_trunc('week',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
 where workspace_id='bd000000-0000-0000-0000-000000000001';
update public.weekly_report_groups set reminders_updated_at=date_trunc('week',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
 where workspace_id='bd000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.claim_weekly_report_reminders(
 (date_trunc('week',now() at time zone 'Asia/Shanghai')+interval '6 days 19 hours') at time zone 'Asia/Shanghai')),1,'completed B stops without stopping incomplete A on same target');
update public.weekly_report_groups set participant_ids='{}' where id=current_setting('test.weekly_group_a')::uuid;
select is((select enabled from public.weekly_report_groups where id=current_setting('test.weekly_group_a')::uuid),false,'empty roster disables group reminders');
select throws_ok($$select * from public.claim_weekly_report_notification_deliveries(current_setting('test.weekly_report_a')::uuid,
 (select notification_revision from public.weekly_reports where id=current_setting('test.weekly_report_a')::uuid),
 'ad000000-0000-0000-0000-000000000003',false)$$,'42501',null,'service-role notification claim rechecks group roster');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ad000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_reports where id=current_setting('test.weekly_report_a')::uuid),1,'removed participant retains own history');
select is((select (g->>'can_view_published')::boolean from public.list_weekly_report_groups('bd000000-0000-0000-0000-000000000001') g
 where g->>'id'=current_setting('test.weekly_group_a')),false,'group API distinguishes own-history access from audience permission');
select throws_ok($$select public.save_group_weekly_report(current_setting('test.weekly_group_a')::uuid,'bd000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Removed write','','','workspace')$$,'42501',null,'removed participant cannot save');
select results_eq($$delete from public.weekly_reports where id=current_setting('test.weekly_report_a')::uuid returning id$$,$$select null::uuid where false$$,'removed participant cannot delete history');
reset role;
delete from public.workspace_members where user_id in ('ad000000-0000-0000-0000-000000000003','ad000000-0000-0000-0000-000000000004') and workspace_id='bd000000-0000-0000-0000-000000000001';
select is((select cardinality(participant_ids) from public.weekly_report_groups where id=current_setting('test.weekly_group_b')::uuid),0,'leaving workspace cleans group roster');
select is((select cardinality(viewer_user_ids) from public.weekly_report_groups where id=current_setting('test.weekly_group_a')::uuid),0,'leaving workspace cleans explicit audience');
set local role anon;
select throws_ok($$select * from public.weekly_report_groups$$,'42501',null,'anonymous cannot access group data');
select throws_ok($$select * from public.list_weekly_report_groups('bd000000-0000-0000-0000-000000000001')$$,'42501',null,'anonymous cannot invoke group API');
reset role;
select * from finish();
rollback;
