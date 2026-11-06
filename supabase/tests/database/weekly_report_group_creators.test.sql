begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('ac200000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated','weekly-creator-'||i||'@example.test','',now(),'{}','{}',now(),now()
from generate_series(1,6) i;
insert into public.workspaces(id,name,created_by) values
 ('bc200000-0000-0000-0000-000000000001','Creator team','ac200000-0000-0000-0000-000000000001'),
 ('bc200000-0000-0000-0000-000000000002','Outside team','ac200000-0000-0000-0000-000000000006');
insert into public.workspace_members(workspace_id,user_id,role)
select 'bc200000-0000-0000-0000-000000000001',('ac200000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 case when i=2 then 'admin'::public.workspace_role else 'member'::public.workspace_role end from generate_series(2,5) i;
insert into public.weekly_report_groups(id,workspace_id,name,participant_ids,created_by)
values ('cc200000-0000-0000-0000-000000000001','bc200000-0000-0000-0000-000000000001','Legacy group','{ac200000-0000-0000-0000-000000000004}',null);
select is((select created_by from public.weekly_report_groups where id='cc200000-0000-0000-0000-000000000001'),null::uuid,'legacy attribution remains unknown');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select set_config('test.creator_group',(public.save_weekly_report_group(
 p_workspace_id=>'bc200000-0000-0000-0000-000000000001',p_name=>'Member created',
 p_participant_ids=>'{ac200000-0000-0000-0000-000000000004}',p_visibility=>'selected')).id::text,true);
select is((select created_by from public.weekly_report_groups where id=current_setting('test.creator_group')::uuid),auth.uid(),'member creates group with server attribution');
select ok(anttodo_private.can_manage_weekly_report_group(current_setting('test.creator_group')::uuid),'creator can manage own group');
select ok(anttodo_private.can_read_weekly_report_group(current_setting('test.creator_group')::uuid),'creator outside roster and audience can read group');
select is((select (g->>'can_view_published')::boolean from public.list_weekly_report_groups('bc200000-0000-0000-0000-000000000001') g where g->>'id'=current_setting('test.creator_group')),true,'list includes creator and published access');
select lives_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000001','Creator edited','{ac200000-0000-0000-0000-000000000004}',p_visibility=>'selected',p_id=>current_setting('test.creator_group')::uuid)$$,'creator can edit');
select throws_ok($$select public.save_group_weekly_report(current_setting('test.creator_group')::uuid,'bc200000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Not a participant','','','workspace')$$,'42501',null,'creator does not gain report write access');
select throws_ok($$update public.weekly_report_groups set created_by='ac200000-0000-0000-0000-000000000005' where id=current_setting('test.creator_group')::uuid$$,'23514',null,'creator cannot transfer ownership');
select throws_ok($$update public.weekly_report_groups set created_by=null where id=current_setting('test.creator_group')::uuid$$,'23514',null,'creator cannot clear ownership');
select throws_ok($$insert into public.weekly_report_groups(workspace_id,name,participant_ids,created_by) values('bc200000-0000-0000-0000-000000000001','Forged','{ac200000-0000-0000-0000-000000000004}','ac200000-0000-0000-0000-000000000005')$$,'23514',null,'direct insert cannot forge creator');
select throws_ok($$insert into public.weekly_report_groups(workspace_id,name,participant_ids,is_default) values('bc200000-0000-0000-0000-000000000001','Default bypass','{ac200000-0000-0000-0000-000000000004}',true)$$,'42501',null,'member cannot create a default group');
select lives_ok($$insert into public.weekly_report_groups(id,workspace_id,name,participant_ids,created_by) values('cc200000-0000-0000-0000-000000000002','bc200000-0000-0000-0000-000000000001','Direct member create','{ac200000-0000-0000-0000-000000000004}',null)$$,'direct member insert records current creator even with explicit null');
select is((select created_by from public.weekly_report_groups where id='cc200000-0000-0000-0000-000000000002'),auth.uid(),'direct insert has current creator');
select throws_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000002','Wrong team','{ac200000-0000-0000-0000-000000000006}')$$,'42501',null,'cannot create across workspaces');
select throws_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000001','Wrong roster','{ac200000-0000-0000-0000-000000000006}')$$,'23514',null,'creator cannot select a foreign roster');
select throws_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000002','Wrong target','{ac200000-0000-0000-0000-000000000004}',p_id=>current_setting('test.creator_group')::uuid)$$,'42501',null,'save rejects mismatched workspace');
select throws_ok($$select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000002',current_setting('test.creator_group')::uuid)$$,'42501',null,'delete rejects mismatched workspace');
select throws_ok($$select public.save_weekly_report_participants('bc200000-0000-0000-0000-000000000001','{ac200000-0000-0000-0000-000000000003}')$$,'42501',null,'creator cannot modify unrelated legacy default');
select throws_ok($$select public.save_weekly_report_reminders('bc200000-0000-0000-0000-000000000001',false,'[]','{}')$$,'42501',null,'creator cannot modify unrelated legacy default reminders');
select results_eq($$update public.weekly_report_groups set name='Legacy bypass' where id='cc200000-0000-0000-0000-000000000001' returning id$$,$$select null::uuid where false$$,'member cannot claim legacy group');

select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select set_config('test.creator_report',(public.save_group_weekly_report(current_setting('test.creator_group')::uuid,'bc200000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date,'Published content','','','workspace','{}','{}',null,true)).id::text,true);
select set_config('test.creator_draft',(public.save_group_weekly_report(current_setting('test.creator_group')::uuid,'bc200000-0000-0000-0000-000000000001',date_trunc('week',current_date)::date-7,'Private draft','','','workspace')).id::text,true);
select throws_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000001','Participant bypass','{ac200000-0000-0000-0000-000000000004}',p_id=>current_setting('test.creator_group')::uuid)$$,'42501',null,'ordinary participant cannot edit group');
select throws_ok($$select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000001',current_setting('test.creator_group')::uuid)$$,'42501',null,'ordinary participant cannot delete group');
select results_eq($$update public.weekly_report_groups set name='Direct bypass' where id=current_setting('test.creator_group')::uuid returning id$$,$$select null::uuid where false$$,'direct update enforces creator management');
select results_eq($$delete from public.weekly_report_groups where id=current_setting('test.creator_group')::uuid returning id$$,$$select null::uuid where false$$,'direct delete enforces creator management');
select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.weekly_reports where id=current_setting('test.creator_report')::uuid),1,'creator can read published report');
select is((select count(*)::int from public.weekly_reports where id=current_setting('test.creator_draft')::uuid),0,'creator cannot read another author draft');
select lives_ok($$delete from public.weekly_report_groups where id='cc200000-0000-0000-0000-000000000002'$$,'creator can directly delete own group');
select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(anttodo_private.can_manage_weekly_report_group(current_setting('test.creator_group')::uuid),'admin manages member-created group');
select lives_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000001','Admin edited','{ac200000-0000-0000-0000-000000000004}',p_visibility=>'selected',p_id=>current_setting('test.creator_group')::uuid)$$,'admin edits creator group');
select is((select created_by from public.weekly_report_groups where id=current_setting('test.creator_group')::uuid),'ac200000-0000-0000-0000-000000000003'::uuid,'admin editing preserves creator');
select throws_ok($$update public.weekly_report_groups set created_by=auth.uid() where id=current_setting('test.creator_group')::uuid$$,'23514',null,'admin cannot transfer creator');
select ok(anttodo_private.can_manage_weekly_report_group('cc200000-0000-0000-0000-000000000001'),'admin manages legacy group');
select lives_ok($$select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000001','cc200000-0000-0000-0000-000000000001')$$,'admin deletes legacy group');
select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select ok(anttodo_private.can_manage_weekly_report_group(current_setting('test.creator_group')::uuid),'owner manages creator group');
select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000001',(select id from public.weekly_report_groups where workspace_id='bc200000-0000-0000-0000-000000000001' and is_default));
select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.save_weekly_report_participants('bc200000-0000-0000-0000-000000000001','{ac200000-0000-0000-0000-000000000004}')$$,'creator can edit fallback roster through legacy API');
select lives_ok($$select public.save_weekly_report_reminders('bc200000-0000-0000-0000-000000000001',false,'[]','{}')$$,'creator can edit fallback reminders through legacy API');

reset role;
delete from public.workspace_members where workspace_id='bc200000-0000-0000-0000-000000000001' and user_id='ac200000-0000-0000-0000-000000000003';
set local role authenticated;
select ok(not anttodo_private.can_manage_weekly_report_group(current_setting('test.creator_group')::uuid),'departed creator loses management');
select is((select count(*)::int from public.weekly_report_groups where id=current_setting('test.creator_group')::uuid),0,'departed creator loses group visibility');
select is((select count(*)::int from public.weekly_reports where id=current_setting('test.creator_report')::uuid),0,'departed creator loses published access');
select throws_ok($$select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000001',current_setting('test.creator_group')::uuid)$$,'42501',null,'departed creator cannot delete');
select throws_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000001','Departed edit','{ac200000-0000-0000-0000-000000000004}',p_id=>current_setting('test.creator_group')::uuid)$$,'42501',null,'departed creator cannot edit');
select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000001',current_setting('test.creator_group')::uuid)$$,'42501',null,'outsider cannot delete');
set local role anon;
select throws_ok($$select public.save_weekly_report_group('bc200000-0000-0000-0000-000000000001','Anonymous','{}')$$,'42501',null,'anonymous cannot create');
select throws_ok($$select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000001',current_setting('test.creator_group')::uuid)$$,'42501',null,'anonymous cannot delete');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.workspace_members(workspace_id,user_id,role) values('bc200000-0000-0000-0000-000000000001','ac200000-0000-0000-0000-000000000003','member');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac200000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select set_config('test.orphan_group',(public.save_weekly_report_group('bc200000-0000-0000-0000-000000000001','Retained attribution','{ac200000-0000-0000-0000-000000000004}',p_visibility=>'selected')).id::text,true);
select lives_ok($$select public.delete_weekly_report_group('bc200000-0000-0000-0000-000000000001',current_setting('test.creator_group')::uuid)$$,'current member creator deletes own group');
reset role;
select is((select count(*)::int from public.weekly_reports where weekly_report_group_id=current_setting('test.creator_group')::uuid),0,'creator deletion cascades reports and drafts');
select set_config('request.jwt.claims','{}',true);
delete from auth.users where id='ac200000-0000-0000-0000-000000000003';
select is((select created_by from public.weekly_report_groups where id=current_setting('test.orphan_group')::uuid),null::uuid,'account deletion clears attribution without deleting the group');
select is((select count(*)::int from public.weekly_report_groups where id=current_setting('test.orphan_group')::uuid),1,'account deletion retains shared group');
select * from finish();
rollback;
