begin;

create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '19000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','yunxiao-owner@example.com','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()
),
(
  '19000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','yunxiao-member@example.com','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()
);

insert into public.workspaces(id,name,created_by)
values('29000000-0000-0000-0000-000000000001','Yunxiao Workspace','19000000-0000-0000-0000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role)
values('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002','member');

insert into public.labels(
  id,workspace_id,name,kind,view_scope,manage_scope,inherit_permissions,created_by
) values
('39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001',
 '云效任务','team','all','all',false,'19000000-0000-0000-0000-000000000001'),
('39000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000001',
 '个人标签','private','users','users',false,'19000000-0000-0000-0000-000000000001');

select throws_ok(
  $$insert into public.connector_instances(
    workspace_id,type,name,schedule_minutes,public_config,created_by
  ) values(
    '29000000-0000-0000-0000-000000000001','yunxiao','缺少标签',30,'{}',
    '19000000-0000-0000-0000-000000000001'
  )$$,
  '23514',null,'Yunxiao connectors require a target label'
);

select throws_ok(
  $$insert into public.connector_instances(
    workspace_id,type,name,schedule_minutes,target_label_id,public_config,created_by
  ) values(
    '29000000-0000-0000-0000-000000000001','yunxiao','错误间隔',10,
    '39000000-0000-0000-0000-000000000001','{}',
    '19000000-0000-0000-0000-000000000001'
  )$$,
  '23514',null,'Yunxiao schedule uses the supported intervals'
);

insert into public.connector_instances(
  id,workspace_id,type,name,enabled,schedule_minutes,target_label_id,public_config,created_by
) values(
  '49000000-0000-0000-0000-000000000001',
  '29000000-0000-0000-0000-000000000001','yunxiao','我的云效',true,30,
  '39000000-0000-0000-0000-000000000001',
  '{"organizationId":"org","projectId":"project","workitemTypeId":"bug","workitemTypeName":"缺陷","categoryId":"BUG","conditions":[],"orderBy":"gmtCreate","sort":"desc","completedStatusId":"done","completedStatusName":"已完成"}',
  '19000000-0000-0000-0000-000000000001'
),(
  '49000000-0000-0000-0000-000000000002',
  '29000000-0000-0000-0000-000000000001','yunxiao','成员的云效',true,30,
  '39000000-0000-0000-0000-000000000001',
  '{"organizationId":"org","projectId":"project","workitemTypeId":"bug","workitemTypeName":"缺陷","categoryId":"BUG","conditions":[],"orderBy":"gmtCreate","sort":"desc","completedStatusId":"done","completedStatusName":"已完成"}',
  '19000000-0000-0000-0000-000000000002'
);

select ok(
  public.can_user_manage_connector_label(
    '29000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000002'
  ),
  'an editable team label can be targeted'
);
select isnt(
  public.can_user_manage_connector_label(
    '29000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000002'
  ),true,
  'another user private label cannot be targeted'
);

select is(
  has_function_privilege('authenticated','public.get_connector_secret(uuid)','execute'),
  false,'authenticated clients cannot read Vault connector secrets'
);
select is(
  has_function_privilege('service_role','public.get_connector_secret(uuid)','execute'),
  true,'service role can read a connector secret'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.upsert_yunxiao_external_task(uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text,uuid)',
    'execute'
  ),false,'authenticated clients cannot execute the external upsert transaction'
);
select is(
  has_function_privilege(
    'authenticated','public.complete_yunxiao_external_task_local(uuid,uuid)','execute'
  ),false,'authenticated clients cannot execute the local completion transaction'
);

set local role service_role;
create temporary table first_upsert as
select * from public.upsert_yunxiao_external_task(
  '49000000-0000-0000-0000-000000000001',
  '59000000-0000-0000-0000-000000000001',
  'workitem-1','远端标题','远端描述','open','2026-08-19T00:00:00Z','v1'
);
select is((select created from first_upsert),true,'the first pull creates an external task');
select is(
  (select connector_platform from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  'yunxiao'::public.connector_type,'the task records its connector platform'
);
select is(
  (select count(*)::integer from public.task_labels where task_id='59000000-0000-0000-0000-000000000001'),
  1,'the target label is attached'
);
select is(
  (select count(*)::integer from public.external_task_links where task_id='59000000-0000-0000-0000-000000000001'),
  1,'the remote version is traced in external_task_links'
);
select is(
  (select due_at from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  null,'an upsert without plan dates leaves the due date empty'
);

do $$ begin
  perform public.upsert_yunxiao_external_task(
    '49000000-0000-0000-0000-000000000001',
    '59000000-0000-0000-0000-000000000001',
    'workitem-1','远端标题','远端描述','open','2026-08-19T00:30:00Z','v1-due',
    '2026-05-27T15:59:59.999Z','2026-05-24T16:00:00Z',true,'Asia/Shanghai'
  );
end $$;
select is(
  (select due_is_all_day from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  true,'plan start and end become an all-day due range'
);
select is(
  (select due_start_at is not null and due_at is not null
    from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  true,'the due range writes both start and end'
);

do $$ begin
  perform public.upsert_yunxiao_external_task(
    '49000000-0000-0000-0000-000000000001',
    '59000000-0000-0000-0000-000000000001',
    'workitem-1','远端标题','远端描述','open','2026-08-19T00:40:00Z','v1-due-end',
    '2026-05-25T08:47:59Z',null,false,'Asia/Shanghai'
  );
end $$;
select is(
  (select due_start_at from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  null,'a plan end without a start maps to a point due date'
);

do $$ begin
  perform public.upsert_yunxiao_external_task(
    '49000000-0000-0000-0000-000000000001',
    '59000000-0000-0000-0000-000000000099',
    'workitem-1','云效覆盖标题','新描述','completed','2026-08-19T01:00:00Z','v2'
  );
end $$;
select is(
  (select count(*)::integer from public.tasks where connector_id='49000000-0000-0000-0000-000000000001' and external_id='workitem-1'),
  1,'a repeated work item is deduplicated per connector'
);
select is(
  (select status from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  'completed'::public.task_status,'remote completed status is mirrored'
);

do $$ begin
  perform public.upsert_yunxiao_external_task(
    '49000000-0000-0000-0000-000000000001',
    '59000000-0000-0000-0000-000000000099',
    'workitem-1','云效重新打开','新描述','open','2026-08-19T02:00:00Z','v3'
  );
end $$;
select is(
  (select status from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  'open'::public.task_status,'a remote reopen reopens the local mirror'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
select results_eq(
  $$select id from public.connector_instances where type='yunxiao' order by id$$,
  $$select '49000000-0000-0000-0000-000000000001'::uuid$$,
  'a user sees only their own Yunxiao connectors'
);
select throws_ok(
  $$insert into public.connector_instances(
    id,workspace_id,type,name,schedule_minutes,target_label_id,public_config,created_by
  ) values(
    '49000000-0000-0000-0000-000000000099',
    '29000000-0000-0000-0000-000000000001','yunxiao','绕过安装',30,
    '39000000-0000-0000-0000-000000000001','{}',
    '19000000-0000-0000-0000-000000000001'
  )$$,
  '42501',null,'authenticated clients cannot bypass Yunxiao installation validation'
);
select lives_ok(
  $$update public.connector_instances set enabled=false
    where id='49000000-0000-0000-0000-000000000001'$$,
  'a direct Yunxiao update is silently filtered by RLS'
);
select is(
  (select enabled from public.connector_instances
    where id='49000000-0000-0000-0000-000000000001'),
  true,'authenticated clients cannot bypass Yunxiao management actions'
);
select throws_ok(
  $$insert into public.tasks(
    id,workspace_id,title,created_by,external_id,connector_id,connector_platform
  ) values(
    '59000000-0000-0000-0000-000000000099',
    '29000000-0000-0000-0000-000000000001','伪造外部任务',
    '19000000-0000-0000-0000-000000000001','fake-workitem',
    '49000000-0000-0000-0000-000000000001','yunxiao'
  )$$,
  '42501',null,'authenticated clients cannot create external tasks directly'
);
select lives_ok(
  $$update public.tasks set title='客户端篡改' where id='59000000-0000-0000-0000-000000000001'$$,
  'RLS silently rejects a normal external task content update'
);
select is(
  (select title from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  '云效重新打开','the external title remains read-only'
);
select throws_ok(
  $$select public.create_task_comment('59000000-0000-0000-0000-000000000001','不允许评论')$$,
  '42501','Task is read-only','comments are blocked for external tasks'
);
select is(
  anttodo_private.can_edit_task('59000000-0000-0000-0000-000000000001'),
  false,'external task content stays read-only'
);
select is(
  anttodo_private.can_organize_task('59000000-0000-0000-0000-000000000001'),
  true,'the connector owner can organize an external task'
);
select lives_ok(
  $$insert into public.tasks(id,workspace_id,title,created_by)
    values(
      '59000000-0000-0000-0000-000000000011',
      '29000000-0000-0000-0000-000000000001','本地新建',
      '19000000-0000-0000-0000-000000000001'
    )$$,
  'the owner can create a local task beside an external task'
);
select lives_ok(
  $$insert into public.task_labels(task_id,label_id)
    values(
      '59000000-0000-0000-0000-000000000011',
      '39000000-0000-0000-0000-000000000001'
    )$$,
  'the local task can share the connector target label'
);
select lives_ok(
  $$select public.set_task_list_order(
      '29000000-0000-0000-0000-000000000001',
      'label:39000000-0000-0000-0000-000000000001',
      null,
      array[
        '59000000-0000-0000-0000-000000000011'::uuid,
        '59000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
      ]
    )$$,
  'creating a local task can reorder a list that already has an external task'
);
select is(
  (
    select position from public.task_list_placements
    where task_id = '59000000-0000-0000-0000-000000000011'
      and list_key = 'label:39000000-0000-0000-0000-000000000001'
  ),
  0,
  'the new local task is placed first'
);
select is(
  (
    select position from public.task_list_placements
    where task_id = '59000000-0000-0000-0000-000000000001'
      and list_key = 'label:39000000-0000-0000-0000-000000000001'
  ),
  1,
  'the external task still receives a list placement'
);
select is(
  (
    select count(*)::integer from public.task_list_placements
    where task_id = '00000000-0000-0000-0000-000000000000'
  ),
  0,
  'unknown task ids in the order payload are ignored'
);
select lives_ok(
  $$insert into public.task_labels(task_id,label_id)
    values('59000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000002')$$,
  'editors can add local labels to an external task'
);
select lives_ok(
  $$insert into public.tasks(id,workspace_id,title,created_by)
    values(
      '59000000-0000-0000-0000-000000000010',
      '29000000-0000-0000-0000-000000000001','本地前置',
      '19000000-0000-0000-0000-000000000001'
    )$$,
  'the owner can create a local predecessor for an external dependency'
);
select lives_ok(
  $$insert into public.task_dependencies(workspace_id,task_id,depends_on_task_id)
    values(
      '29000000-0000-0000-0000-000000000001',
      '59000000-0000-0000-0000-000000000001',
      '59000000-0000-0000-0000-000000000010'
    )$$,
  'an editor can mount a local dependency on an external task'
);
select lives_ok(
  $$select public.set_external_task_deleted_at(
      '59000000-0000-0000-0000-000000000001',
      '2026-08-20T08:00:00Z'
    )$$,
  'an editor can move an external task to trash'
);
select is(
  (select deleted_at is not null from public.tasks
    where id='59000000-0000-0000-0000-000000000001'),
  true,'the external task records a local deletion'
);
select lives_ok(
  $$delete from public.connector_instances where id='49000000-0000-0000-0000-000000000001'$$,
  'a direct Yunxiao delete is silently filtered by RLS'
);
select is(
  (select count(*)::integer from public.connector_instances
    where id='49000000-0000-0000-0000-000000000001'),
  1,'authenticated clients cannot bypass Yunxiao deletion cleanup'
);

reset role;
set local role service_role;
do $$ begin
  perform public.upsert_yunxiao_external_task(
    '49000000-0000-0000-0000-000000000001',
    '59000000-0000-0000-0000-000000000001',
    'workitem-1','云效重新打开','新描述','open','2026-08-19T03:00:00Z','v4'
  );
end $$;
select isnt(
  (select deleted_at from public.tasks where id='59000000-0000-0000-0000-000000000001'),
  null,
  'a later sync keeps a locally deleted external task in the trash'
);
select is(
  (select count(*)::integer from public.task_labels where task_id='59000000-0000-0000-0000-000000000001'),
  2,'a later sync keeps extra local labels on an external task'
);
select throws_ok(
  $$delete from public.connector_instances where id='49000000-0000-0000-0000-000000000001'$$,
  '23503',null,'the database restricts deleting a connector with external tasks'
);
select is(
  (public.complete_yunxiao_external_task_local(
    '59000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001'
  )).status,
  'completed'::public.task_status,'the service transaction completes for the connector owner'
);
select throws_ok(
  $$select public.complete_yunxiao_external_task_local(
    '59000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000002'
  )$$,
  '42501','External task completion forbidden',
  'a different user cannot use the completion transaction'
);

select * from finish();
rollback;
