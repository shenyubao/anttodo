begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('af000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated','weekly-participant-group-'||i||'@example.test','',now(),'{}','{}',now(),now()
from generate_series(1,5) i;
insert into public.workspaces(id,name,created_by) values
 ('bf000000-0000-0000-0000-000000000001','Participant team','af000000-0000-0000-0000-000000000001'),
 ('bf000000-0000-0000-0000-000000000002','Outside','af000000-0000-0000-0000-000000000005');
insert into public.workspace_members(workspace_id,user_id,role)
select 'bf000000-0000-0000-0000-000000000001',('af000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'member'::public.workspace_role from generate_series(2,4) i;
insert into public.user_groups(id,workspace_id,name,created_by) values
 ('cf000000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001','First','af000000-0000-0000-0000-000000000001'),
 ('cf000000-0000-0000-0000-000000000002','bf000000-0000-0000-0000-000000000001','Second','af000000-0000-0000-0000-000000000001'),
 ('cf000000-0000-0000-0000-000000000003','bf000000-0000-0000-0000-000000000001','Empty','af000000-0000-0000-0000-000000000001'),
 ('cf000000-0000-0000-0000-000000000004','bf000000-0000-0000-0000-000000000002','Outside','af000000-0000-0000-0000-000000000005');
insert into public.user_group_members(group_id,workspace_id,user_id) values
 ('cf000000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001','af000000-0000-0000-0000-000000000002'),
 ('cf000000-0000-0000-0000-000000000002','bf000000-0000-0000-0000-000000000001','af000000-0000-0000-0000-000000000002'),
 ('cf000000-0000-0000-0000-000000000002','bf000000-0000-0000-0000-000000000001','af000000-0000-0000-0000-000000000003');
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed immediate;
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed deferred;
insert into public.weekly_report_notification_groups(id,workspace_id,type,name,credential_secret_id) values
 ('ef000000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001','dingtalk','Target',vault.create_secret('{}'));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.participant_group',(public.save_weekly_report_group(
 p_workspace_id=>'bf000000-0000-0000-0000-000000000001',p_name=>'Group roster',
 p_participant_ids=>'{af000000-0000-0000-0000-000000000005}',p_visibility=>'selected',
 p_participant_mode=>'groups',p_participant_group_ids=>'{cf000000-0000-0000-0000-000000000001,cf000000-0000-0000-0000-000000000002}',
 p_enabled=>true,p_schedules=>'[{"day":5,"time":"18:00"}]',p_notification_group_ids=>'{ef000000-0000-0000-0000-000000000001}')).id::text,true);
select is((select participant_ids::text from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),
 '{af000000-0000-0000-0000-000000000002,af000000-0000-0000-0000-000000000003}','server derives a sorted distinct roster and ignores submitted IDs');
select is((select participant_mode from public.weekly_report_groups where workspace_id='bf000000-0000-0000-0000-000000000001' and is_default),'users','existing default group remains in users mode');
select lives_ok($$select public.save_weekly_report_group('bf000000-0000-0000-0000-000000000001','Legacy edit','{af000000-0000-0000-0000-000000000001}',p_visibility=>'selected',p_id=>current_setting('test.participant_group')::uuid)$$,'legacy edit remains callable');
select is((select participant_mode from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),'groups','omitted source fields preserve mode');
select is((select cardinality(participant_group_ids) from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),2,'legacy edit preserves associations');
select throws_ok($$select public.save_weekly_report_group('bf000000-0000-0000-0000-000000000001','Cross-space','{}',p_participant_mode=>'groups',p_participant_group_ids=>'{cf000000-0000-0000-0000-000000000004}')$$,'23514',null,'cross-workspace user group rejected');
select throws_ok($$select public.save_weekly_report_group('bf000000-0000-0000-0000-000000000001','No groups','{}',p_participant_mode=>'groups')$$,'23514',null,'new group requires an association');
select throws_ok($$select public.save_weekly_report_group('bf000000-0000-0000-0000-000000000001','Null group','{}',p_participant_mode=>'groups',p_participant_group_ids=>'{NULL}')$$,'23514',null,'null group rejected');
select set_config('test.empty_participant_group',(public.save_weekly_report_group('bf000000-0000-0000-0000-000000000001','Empty roster','{}',
 p_participant_mode=>'groups',p_participant_group_ids=>'{cf000000-0000-0000-0000-000000000003}',p_enabled=>true)).id::text,true);
select is((select enabled from public.weekly_report_groups where id=current_setting('test.empty_participant_group')::uuid),false,'empty groups can be created with reminders forced off');
select set_config('request.jwt.claims','{"sub":"af000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(anttodo_private.can_read_weekly_report_group(current_setting('test.participant_group')::uuid),'group member automatically gets audience access');
select ok(anttodo_private.can_write_group_weekly_report('bf000000-0000-0000-0000-000000000001',current_setting('test.participant_group')::uuid),'group member can fill reports');
select set_config('test.participant_report',(public.save_group_weekly_report(current_setting('test.participant_group')::uuid,
 'bf000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Group report','','','workspace','{}','{}',null,true)).id::text,true);
select throws_ok($$select public.save_weekly_report_group('bf000000-0000-0000-0000-000000000001','Unauthorized','{}',p_id=>current_setting('test.participant_group')::uuid,p_participant_mode=>'groups',p_participant_group_ids=>'{cf000000-0000-0000-0000-000000000001}')$$,'42501',null,'non-creator member cannot configure another group');
select results_eq($$update public.weekly_report_groups set participant_ids='{af000000-0000-0000-0000-000000000004}' where id=current_setting('test.participant_group')::uuid returning id$$,$$select null::uuid where false$$,'direct roster update cannot bypass management permissions');
reset role;
-- Removing one overlapping association preserves the effective member.
delete from public.user_group_members where group_id='cf000000-0000-0000-0000-000000000001';
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed immediate;
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed deferred;
select is((select cardinality(participant_ids) from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),2,'overlapping membership remains after removal from one group');
-- Replacing every member must not disable an enabled reminder mid-transaction.
update public.weekly_report_groups set enabled=true,schedules='[{"day":5,"time":"18:00"}]',notification_group_ids='{ef000000-0000-0000-0000-000000000001}' where id=current_setting('test.participant_group')::uuid;
delete from public.user_group_members where group_id='cf000000-0000-0000-0000-000000000002';
insert into public.user_group_members(group_id,workspace_id,user_id) values
 ('cf000000-0000-0000-0000-000000000002','bf000000-0000-0000-0000-000000000001','af000000-0000-0000-0000-000000000004');
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed immediate;
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed deferred;
select is((select participant_ids::text from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),'{af000000-0000-0000-0000-000000000004}','batch replacement uses final membership');
select is((select enabled from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),true,'batch replacement keeps reminders enabled');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(not anttodo_private.can_write_group_weekly_report('bf000000-0000-0000-0000-000000000001',current_setting('test.participant_group')::uuid),'removed member loses write permission');
select ok(not anttodo_private.can_read_weekly_report_group(current_setting('test.participant_group')::uuid),'removed member loses automatic audience access');
select is((select count(*)::int from public.weekly_reports where id=current_setting('test.participant_report')::uuid),1,'removed member retains own historical report');
select throws_ok($$select public.save_group_weekly_report(current_setting('test.participant_group')::uuid,'bf000000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Forbidden','','','workspace')$$,'42501',null,'removed member cannot save historical report');
select set_config('request.jwt.claims','{"sub":"af000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select ok(anttodo_private.can_write_group_weekly_report('bf000000-0000-0000-0000-000000000001',current_setting('test.participant_group')::uuid),'new member gains write permission');
select is((select count(*)::int from public.weekly_reports where id=current_setting('test.participant_report')::uuid),1,'new member can see published group history');
reset role;
update public.weekly_report_groups set reminders_updated_at=date_trunc('week',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' where id=current_setting('test.participant_group')::uuid;
create temp table participant_claims as select * from public.claim_weekly_report_reminders(
 (date_trunc('week',now() at time zone 'Asia/Shanghai')+interval '4 days 18 hours') at time zone 'Asia/Shanghai');
select is((select snapshot->>'total' from participant_claims where weekly_report_group_id=current_setting('test.participant_group')::uuid),'1','reminder total uses current effective roster');
select is((select snapshot->>'submitted' from participant_claims where weekly_report_group_id=current_setting('test.participant_group')::uuid),'0','historical removed author does not count as a submission');
-- Delete one selected group, then replace its members in another selected
-- group in the same transaction; even source deletion cannot turn reminders off.
update public.weekly_report_groups set viewer_group_ids='{cf000000-0000-0000-0000-000000000002}' where id=current_setting('test.participant_group')::uuid;
delete from public.user_groups where id='cf000000-0000-0000-0000-000000000002';
insert into public.user_group_members(group_id,workspace_id,user_id) values
 ('cf000000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001','af000000-0000-0000-0000-000000000004');
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed immediate;
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed deferred;
select is((select enabled from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),true,'source deletion and membership replacement use final roster');
select is((select cardinality(participant_group_ids) from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),1,'source deletion cleans only the deleted association');
select is((select cardinality(viewer_group_ids) from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),0,'source deletion also cleans viewer references');
-- Empty -> populated does not silently turn reminders back on.
insert into public.user_group_members(group_id,workspace_id,user_id) values
 ('cf000000-0000-0000-0000-000000000003','bf000000-0000-0000-0000-000000000001','af000000-0000-0000-0000-000000000003');
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed immediate;
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed deferred;
select is((select cardinality(participant_ids) from public.weekly_report_groups where id=current_setting('test.empty_participant_group')::uuid),1,'empty group picks up a new member automatically');
select is((select enabled from public.weekly_report_groups where id=current_setting('test.empty_participant_group')::uuid),false,'joining an empty group leaves reminders off');
delete from public.workspace_members where workspace_id='bf000000-0000-0000-0000-000000000001' and user_id='af000000-0000-0000-0000-000000000004';
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed immediate;
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed deferred;
select is((select cardinality(participant_ids) from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),0,'workspace departure cleans effective roster');
select is((select enabled from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),false,'final empty roster disables reminders');
delete from public.user_groups where id='cf000000-0000-0000-0000-000000000003';
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed immediate;
set constraints weekly_report_groups_sync_members, weekly_report_groups_user_group_removed deferred;
select is((select cardinality(participant_group_ids) from public.weekly_report_groups where id=current_setting('test.empty_participant_group')::uuid),0,'deleting a user group cleans associations');
select is((select cardinality(participant_ids) from public.weekly_report_groups where id=current_setting('test.empty_participant_group')::uuid),0,'deleting a user group cleans its effective members');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_weekly_report_group('bf000000-0000-0000-0000-000000000001','Switch to users','{af000000-0000-0000-0000-000000000003}',p_id=>current_setting('test.participant_group')::uuid,p_participant_mode=>'users')$$,'can explicitly switch a group back to users');
select is((select cardinality(participant_group_ids) from public.weekly_report_groups where id=current_setting('test.participant_group')::uuid),0,'users mode clears associations');
reset role;
select * from finish();
rollback;
