begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('19200000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','local-assignment-1@example.com','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('19200000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','local-assignment-2@example.com','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('19200000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','local-assignment-3@example.com','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('19200000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','local-assignment-4@example.com','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('19200000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','local-assignment-5@example.com','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.workspaces(id,name,created_by) values('29200000-0000-0000-0000-000000000001','Local assignment','19200000-0000-0000-0000-000000000001');

insert into public.workspaces(id,name,created_by) values('29200000-0000-0000-0000-000000000002','Other workspace','19200000-0000-0000-0000-000000000005');

insert into public.workspace_members(workspace_id,user_id,role) values('29200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002','member');

insert into public.workspace_members(workspace_id,user_id,role) values('29200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000003','member');

insert into public.workspace_members(workspace_id,user_id,role) values('29200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000004','member');

insert into public.labels(id,workspace_id,name,kind,view_scope,manage_scope,inherit_permissions,created_by) values('39200000-0000-0000-0000-000000000001','29200000-0000-0000-0000-000000000001','Label 1','team','users','users',false,'19200000-0000-0000-0000-000000000001');

insert into public.labels(id,workspace_id,name,kind,view_scope,manage_scope,inherit_permissions,created_by) values('39200000-0000-0000-0000-000000000002','29200000-0000-0000-0000-000000000001','Label 2','team','all','users',false,'19200000-0000-0000-0000-000000000001');

insert into public.label_user_acl(label_id,workspace_id,user_id,permission) values('39200000-0000-0000-0000-000000000001','29200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002','edit');

insert into public.label_user_acl(label_id,workspace_id,user_id,permission) values('39200000-0000-0000-0000-000000000001','29200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000003','view');

insert into public.connector_instances(id,workspace_id,type,name,enabled,schedule_minutes,target_label_id,public_config,created_by) values('49200000-0000-0000-0000-000000000001','29200000-0000-0000-0000-000000000001','yunxiao','Connector 1',true,60,'39200000-0000-0000-0000-000000000001','{"kind":"quick_create","organizationId":"org"}','19200000-0000-0000-0000-000000000001');

insert into public.connector_instances(id,workspace_id,type,name,enabled,schedule_minutes,target_label_id,public_config,created_by) values('49200000-0000-0000-0000-000000000002','29200000-0000-0000-0000-000000000001','yunxiao','Connector 2',true,60,'39200000-0000-0000-0000-000000000001','{"organizationId":"org"}','19200000-0000-0000-0000-000000000001');

select * from public.upsert_yunxiao_external_task('49200000-0000-0000-0000-000000000001','59200000-0000-0000-0000-000000000001','workitem-1','Remote title','Remote description','open',now());

select * from public.upsert_yunxiao_external_task('49200000-0000-0000-0000-000000000001','59200000-0000-0000-0000-000000000002','workitem-2','Remote title','Remote description','open',now());

select * from public.upsert_yunxiao_external_task('49200000-0000-0000-0000-000000000002','59200000-0000-0000-0000-000000000003','workitem-3','Remote title','Remote description','open',now());

insert into public.task_labels(task_id,label_id) values('59200000-0000-0000-0000-000000000002','39200000-0000-0000-0000-000000000002');

insert into public.tasks(id,workspace_id,title,created_by) values('59200000-0000-0000-0000-000000000004','29200000-0000-0000-0000-000000000001','Local task','19200000-0000-0000-0000-000000000001');

insert into public.task_labels(task_id,label_id) values('59200000-0000-0000-0000-000000000004','39200000-0000-0000-0000-000000000001');

insert into public.user_ai_work_settings(user_id,workspace_id,cli_tools,default_working_path) values('19200000-0000-0000-0000-000000000002','29200000-0000-0000-0000-000000000001',array['codex']::public.ai_cli_tool[],'/tmp/anttodo');

set local role authenticated;

select set_config('request.jwt.claim.sub','19200000-0000-0000-0000-000000000002',true);

select ok(anttodo_private.can_assign_quick_create_task('59200000-0000-0000-0000-000000000001'),'label editor can assign an existing quick-create task');

select is((select count(*) from public.list_task_assignees('59200000-0000-0000-0000-000000000001')),3::bigint,'candidate lookup includes only visible workspace members');

select is((select (public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002',null)).assignee_id),'19200000-0000-0000-0000-000000000002'::uuid,'editor can assign to self');

select is((select (public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000003',null)).assignee_id),'19200000-0000-0000-0000-000000000003'::uuid,'editor can assign a member who can view the task');

select is((select count(*) from public.activity_events where task_id='59200000-0000-0000-0000-000000000001' and event_type='task.assignee_changed' and actor_id='19200000-0000-0000-0000-000000000002'),2::bigint,'local assignment records the authenticated actor');

select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000003',null);

select is((select count(*) from public.activity_events where task_id='59200000-0000-0000-0000-000000000001' and event_type='task.assignee_changed'),2::bigint,'assigning the same target does not emit another event');

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000004',null)$$,'42501',null,'hidden team member cannot be assigned');

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000005',null)$$,'42501',null,'member from another workspace cannot be assigned');

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002','codex')$$,'23514',null,'member and CLI targets are mutually exclusive');

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001',null,'claude')$$,'42501',null,'CLI must be enabled for the acting user');

select is((select (public.assign_task('59200000-0000-0000-0000-000000000001',null,'codex')).cli_assignee),'codex'::public.ai_cli_tool,'editor can switch a member assignment to a configured CLI');

select ok((select assignee_id is null from public.tasks where id='59200000-0000-0000-0000-000000000001'),'CLI assignment clears the member');

with changed as (update public.tasks set title='Illegal',assignee_id='19200000-0000-0000-0000-000000000002',cli_assignee=null where id='59200000-0000-0000-0000-000000000001' returning id)
select is(count(*),0::bigint,'direct update cannot change external content or assignment') from changed;

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000002','19200000-0000-0000-0000-000000000002',null)$$,'42501',null,'multi-label permissions require edit access to every label');

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000003','19200000-0000-0000-0000-000000000002',null)$$,'42501',null,'scheduled external task remains read-only');

select throws_ok($$select anttodo_private.assign_quick_create_task('59200000-0000-0000-0000-000000000003','19200000-0000-0000-0000-000000000002',null)$$,'42501',null,'private helper cannot bypass scheduled-task restriction');

select is((select (public.assign_task('59200000-0000-0000-0000-000000000004','19200000-0000-0000-0000-000000000002',null)).assignee_id),'19200000-0000-0000-0000-000000000002'::uuid,'normal task assignment remains compatible');

set local role authenticated;

select set_config('request.jwt.claim.sub','19200000-0000-0000-0000-000000000003',true);

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000003',null)$$,'42501',null,'viewer cannot assign the task');

select throws_ok($$select * from public.list_task_assignees('59200000-0000-0000-0000-000000000001')$$,'42501',null,'viewer cannot query assignable candidates');

select throws_ok($$select anttodo_private.assign_quick_create_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000003',null)$$,'42501',null,'private helper checks caller permissions directly');

set local role authenticated;

select set_config('request.jwt.claim.sub','19200000-0000-0000-0000-000000000005',true);

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000005',null)$$,'42501',null,'outsider cannot assign the task');

reset role;

select set_config('request.jwt.claim.sub','',true);

select * from public.upsert_yunxiao_external_task('49200000-0000-0000-0000-000000000001','59200000-0000-0000-0000-000000000001','workitem-1','Updated remote title','Updated remote description','open',now());

select ok((select cli_assignee = 'codex' and assignee_id is null and title='Updated remote title' from public.tasks where id='59200000-0000-0000-0000-000000000001'),'reimport preserves the local CLI while refreshing remote content');

update public.connector_instances set enabled=false where id='49200000-0000-0000-0000-000000000001';

set local role authenticated;

select set_config('request.jwt.claim.sub','19200000-0000-0000-0000-000000000002',true);

select is((select (public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002',null)).assignee_id),'19200000-0000-0000-0000-000000000002'::uuid,'disabled connector still allows local assignment');

select ok((select cli_assignee is null from public.tasks where id='59200000-0000-0000-0000-000000000001'),'member assignment clears CLI');

select ok((select assignee_id is null and cli_assignee is null from public.assign_task('59200000-0000-0000-0000-000000000001',null,null)),'editor can clear the assignment');

select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002',null);

reset role;

update public.tasks set deleted_at=now() where id='59200000-0000-0000-0000-000000000001';

set local role authenticated;

select set_config('request.jwt.claim.sub','19200000-0000-0000-0000-000000000002',true);

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000003',null)$$,'42501',null,'recycled external task cannot be assigned');

reset role;

select set_config('request.jwt.claim.sub','',true);

set local role anon;

select throws_ok($$select public.assign_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002',null)$$,'42501',null,'anonymous callers cannot assign tasks');

select throws_ok($$select anttodo_private.assign_quick_create_task('59200000-0000-0000-0000-000000000001','19200000-0000-0000-0000-000000000002',null)$$,'42501',null,'anonymous callers cannot invoke the private write helper');

reset role;

select * from finish();

rollback;
