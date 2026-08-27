begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '19100000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','yunxiao-qc-owner@example.com','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()
),
(
  '19100000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','yunxiao-qc-member@example.com','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()
);

insert into public.workspaces(id,name,created_by)
values('29100000-0000-0000-0000-000000000001','Yunxiao Quick Create','19100000-0000-0000-0000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role)
values('29100000-0000-0000-0000-000000000001','19100000-0000-0000-0000-000000000002','member');

insert into public.labels(
  id,workspace_id,name,kind,view_scope,manage_scope,inherit_permissions,created_by
) values
('39100000-0000-0000-0000-000000000001','29100000-0000-0000-0000-000000000001',
 '云效创建','team','all','all',false,'19100000-0000-0000-0000-000000000001');

insert into public.connector_instances(
  id,workspace_id,type,name,enabled,schedule_minutes,target_label_id,public_config,created_by,next_sync_at
) values(
  '49100000-0000-0000-0000-000000000001',
  '29100000-0000-0000-0000-000000000001','yunxiao','云效创建',true,1440,
  '39100000-0000-0000-0000-000000000001',
  '{"kind":"quick_create","organizationId":"org"}',
  '19100000-0000-0000-0000-000000000001',
  now() - interval '1 minute'
);

select throws_ok(
  $$insert into public.connector_instances(
    workspace_id,type,name,enabled,schedule_minutes,target_label_id,public_config,created_by
  ) values(
    '29100000-0000-0000-0000-000000000001','yunxiao','重复云效创建',true,1440,
    '39100000-0000-0000-0000-000000000001',
    '{"kind":"quick_create","organizationId":"org-2"}',
    '19100000-0000-0000-0000-000000000001'
  )$$,
  '23505',null,'each workspace can install Yunxiao quick create once'
);

select ok(
  position('quick_create' in pg_get_functiondef(
    'anttodo_private.invoke_yunxiao_connector_sync()'::regprocedure
  )) > 0,
  'the Yunxiao cron skips quick_create connectors'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','19100000-0000-0000-0000-000000000002',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"19100000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select results_eq(
  $$select id from public.connector_instances where type='yunxiao'$$,
  $$select '49100000-0000-0000-0000-000000000001'::uuid$$,
  'workspace members can see the Yunxiao quick create instance'
);

select throws_ok(
  $$insert into public.connector_instances(
    workspace_id,type,name,schedule_minutes,target_label_id,public_config,created_by
  ) values(
    '29100000-0000-0000-0000-000000000001','yunxiao','成员直写',1440,
    '39100000-0000-0000-0000-000000000001',
    '{"kind":"quick_create","organizationId":"org"}',
    '19100000-0000-0000-0000-000000000002'
  )$$,
  '42501',null,'members cannot insert Yunxiao quick create directly'
);

select throws_ok(
  $$insert into public.tasks(
    id,workspace_id,title,created_by,external_id,connector_id,connector_platform
  ) values(
    '59100000-0000-0000-0000-000000000099',
    '29100000-0000-0000-0000-000000000001','伪造外部任务',
    '19100000-0000-0000-0000-000000000002','fake-workitem',
    '49100000-0000-0000-0000-000000000001','yunxiao'
  )$$,
  '42501',null,'members cannot create external tasks directly'
);

reset role;
set local role service_role;

create temporary table qc_upsert as
select * from public.upsert_yunxiao_external_task(
  '49100000-0000-0000-0000-000000000001',
  '59100000-0000-0000-0000-000000000001',
  'workitem-qc','云效标题','云效描述','open','2026-08-26T00:00:00Z','v1',
  null,null,false,null,
  '19100000-0000-0000-0000-000000000002'
);

select is((select created from qc_upsert), true, 'quick create upsert inserts a new external task');
select is(
  (select created_by from public.tasks where id='59100000-0000-0000-0000-000000000001'),
  '19100000-0000-0000-0000-000000000002'::uuid,
  'insert uses the paste author as created_by'
);

do $$ begin
  perform public.upsert_yunxiao_external_task(
    '49100000-0000-0000-0000-000000000001',
    '59100000-0000-0000-0000-000000000099',
    'workitem-qc','更新标题','更新描述','open','2026-08-26T01:00:00Z','v2',
    null,null,false,null,
    '19100000-0000-0000-0000-000000000001'
  );
end $$;

select is(
  (select created_by from public.tasks where id='59100000-0000-0000-0000-000000000001'),
  '19100000-0000-0000-0000-000000000002'::uuid,
  'a later upsert does not change created_by'
);

select lives_ok(
  $$select public.complete_yunxiao_external_task_local(
    '59100000-0000-0000-0000-000000000001',
    '19100000-0000-0000-0000-000000000002'
  )$$,
  'the paste author can complete a quick-create external task'
);

select * from finish();
rollback;
