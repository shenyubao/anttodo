begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '18000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'robot-owner@example.com', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '18000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'robot-assignee@example.com', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '18000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'robot-participant@example.com', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.workspaces (id, name, created_by)
values (
  '28000000-0000-0000-0000-000000000001',
  'Robot Workspace',
  '18000000-0000-0000-0000-000000000001'
);

insert into public.workspace_members (workspace_id, user_id, role)
values
(
  '28000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0000-000000000002',
  'member'
),
(
  '28000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0000-000000000003',
  'member'
);

insert into public.labels (
  id, workspace_id, name, kind, view_scope, manage_scope,
  inherit_permissions, created_by
) values (
  '38000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000001',
  '机器人', 'team', 'all', 'all', false,
  '18000000-0000-0000-0000-000000000001'
);

insert into public.connector_instances (
  id, workspace_id, type, name, enabled, public_config, created_by
) values (
  '48000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000001',
  'dingtalk', '钉钉群机器人', true,
  '{"kind":"group_robot","timezone":"Asia/Shanghai"}'::jsonb,
  '18000000-0000-0000-0000-000000000001'
);

select throws_ok(
  $$
    insert into public.connector_instances (
      workspace_id, type, name, public_config, created_by
    ) values (
      '28000000-0000-0000-0000-000000000001',
      'dingtalk', '重复机器人', '{"kind":"group_robot"}'::jsonb,
      '18000000-0000-0000-0000-000000000001'
    )
  $$,
  '23505',
  null,
  'a workspace can install only one DingTalk group robot'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.create_task_from_dingtalk_group_robot(uuid,text,uuid,text,timestamptz,timestamptz,boolean,text,uuid,uuid[],text[])',
    'execute'
  ),
  false,
  'authenticated clients cannot execute the robot task transaction'
);

select is(
  has_function_privilege(
    'service_role',
    'public.create_task_from_dingtalk_group_robot(uuid,text,uuid,text,timestamptz,timestamptz,boolean,text,uuid,uuid[],text[])',
    'execute'
  ),
  true,
  'service role can execute the robot task transaction'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.attach_dingtalk_group_robot_images(uuid,text,uuid,text)',
    'execute'
  ),
  false,
  'authenticated clients cannot attach robot message images'
);

select is(
  has_function_privilege(
    'service_role',
    'public.attach_dingtalk_group_robot_images(uuid,text,uuid,text)',
    'execute'
  ),
  true,
  'service role can attach robot message images'
);

set local role service_role;

create temporary table robot_result as
select * from public.create_task_from_dingtalk_group_robot(
  '48000000-0000-0000-0000-000000000001',
  'ding-message-1',
  '18000000-0000-0000-0000-000000000001',
  '群里创建的任务',
  '2026-08-10T07:00:00Z',
  null,
  false,
  'Asia/Shanghai',
  '18000000-0000-0000-0000-000000000002',
  array['18000000-0000-0000-0000-000000000003']::uuid[],
  array['机器人', '不存在']::text[]
);

select is((select duplicate from robot_result), false, 'first delivery creates a task');
select is(
  (select title from public.tasks where id = (select task_id from robot_result)),
  '群里创建的任务',
  'the task title is persisted'
);
select is(
  (select created_by from public.tasks where id = (select task_id from robot_result)),
  '18000000-0000-0000-0000-000000000001'::uuid,
  'the mapped sender is the creator'
);
select is(
  (select assignee_id from public.tasks where id = (select task_id from robot_result)),
  '18000000-0000-0000-0000-000000000002'::uuid,
  'the first mapped mention is the assignee'
);
select is(
  (select count(*)::integer from public.task_labels where task_id = (select task_id from robot_result)),
  1,
  'only the unique writable label is applied'
);
select is(
  (select count(*)::integer from public.task_participants where task_id = (select task_id from robot_result)),
  2,
  'the sender and remaining mention become participants'
);
select is(
  (select actor_id from public.activity_events
   where task_id = (select task_id from robot_result) and event_type = 'task.created'
   order by created_at desc limit 1),
  '18000000-0000-0000-0000-000000000001'::uuid,
  'task creation activity records the mapped sender'
);
select is(
  (select count(*)::integer from anttodo_private.dingtalk_group_robot_receipts),
  1,
  'the message receipt is recorded'
);

select is(
  public.attach_dingtalk_group_robot_images(
    '48000000-0000-0000-0000-000000000001',
    'ding-message-1',
    '18000000-0000-0000-0000-000000000001',
    '![钉钉图片 1](anttodo-storage://task-attachments/28000000-0000-0000-0000-000000000001/' ||
      (select task_id from robot_result)::text ||
      '/58000000-0000-0000-0000-000000000001.png)'
  ),
  true,
  'the robot can attach image references to a newly created task'
);

select is(
  position(
    'anttodo-storage://task-attachments/' in
    (select description from public.tasks where id = (select task_id from robot_result))
  ) > 0,
  true,
  'the stored image is referenced from the task description'
);

select is(
  (select actor_id from public.activity_events
   where task_id = (select task_id from robot_result) and event_type = 'task.updated'
   order by created_at desc limit 1),
  '18000000-0000-0000-0000-000000000001'::uuid,
  'the image description activity records the mapped sender'
);

select is(
  public.attach_dingtalk_group_robot_images(
    '48000000-0000-0000-0000-000000000001',
    'ding-message-1',
    '18000000-0000-0000-0000-000000000001',
    '不能覆盖已有正文'
  ),
  false,
  'a repeated callback does not overwrite an existing description'
);

select is(
  position(
    '不能覆盖已有正文' in
    (select description from public.tasks where id = (select task_id from robot_result))
  ),
  0,
  'the existing image description is preserved on retry'
);

create temporary table duplicate_result as
select * from public.create_task_from_dingtalk_group_robot(
  '48000000-0000-0000-0000-000000000001',
  'ding-message-1',
  '18000000-0000-0000-0000-000000000001',
  '不会重复创建',
  null, null, false, 'Asia/Shanghai', null,
  array[]::uuid[], array[]::text[]
);

select is((select duplicate from duplicate_result), true, 'a repeated message is idempotent');
select is(
  (select task_id from duplicate_result),
  (select task_id from robot_result),
  'the repeated message returns the original task'
);
select is(
  (select count(*)::integer from public.tasks where workspace_id = '28000000-0000-0000-0000-000000000001'),
  1,
  'a repeated message does not create another task'
);

insert into public.labels (
  id, workspace_id, name, kind, view_scope, manage_scope,
  inherit_permissions, created_by
) values (
  '38000000-0000-0000-0000-000000000002',
  '28000000-0000-0000-0000-000000000001',
  '机器人', 'team', 'all', 'all', false,
  '18000000-0000-0000-0000-000000000001'
);

create temporary table ambiguous_label_result as
select * from public.create_task_from_dingtalk_group_robot(
  '48000000-0000-0000-0000-000000000001',
  'ding-message-2',
  '18000000-0000-0000-0000-000000000001',
  '重名标签不会绑定',
  null, null, false, 'Asia/Shanghai', null,
  array[]::uuid[], array['机器人']::text[]
);

select is(
  (select cardinality(selected_label_ids) from ambiguous_label_result),
  0,
  'an ambiguous label name is silently ignored'
);
select is(
  (select count(*)::integer from public.task_labels
   where task_id = (select task_id from ambiguous_label_result)),
  0,
  'an ambiguous label is not attached to the task'
);

update public.connector_instances
set enabled = false
where id = '48000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select public.create_task_from_dingtalk_group_robot(
      '48000000-0000-0000-0000-000000000001',
      'ding-message-3',
      '18000000-0000-0000-0000-000000000001',
      '停用后不能创建',
      null, null, false, 'Asia/Shanghai', null,
      array[]::uuid[], array[]::text[]
    )
  $$,
  '42501',
  'DingTalk group robot is not enabled',
  'a disabled connector cannot create tasks'
);

select is(
  (select last_synced_at is not null from public.connector_instances
   where id = '48000000-0000-0000-0000-000000000001'),
  true,
  'successful use updates the connector verification timestamp'
);

select * from finish();
rollback;
