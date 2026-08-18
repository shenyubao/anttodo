begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '15000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-owner@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '15000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-member@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '15000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-outsider@example.com', '', now(), '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, created_by)
values (
  '25000000-0000-0000-0000-000000000001',
  'AI Work Test',
  '15000000-0000-0000-0000-000000000001'
);

insert into public.workspace_members(workspace_id, user_id, role)
values (
  '25000000-0000-0000-0000-000000000001',
  '15000000-0000-0000-0000-000000000002',
  'member'
);

insert into public.tasks(id, workspace_id, title, description, created_by)
values (
  '45000000-0000-0000-0000-000000000001',
  '25000000-0000-0000-0000-000000000001',
  'AI task',
  'Parent context',
  '15000000-0000-0000-0000-000000000001'
);

insert into public.tasks(id, workspace_id, parent_task_id, title, created_by)
values (
  '55000000-0000-0000-0000-000000000001',
  '25000000-0000-0000-0000-000000000001',
  '45000000-0000-0000-0000-000000000001',
  'AI child task',
  '15000000-0000-0000-0000-000000000001'
);

select has_type('public', 'ai_cli_tool', 'CLI enum exists');
select enum_has_labels(
  'public', 'ai_cli_tool', array['codex', 'claude'],
  'CLI enum has the supported fixed tools'
);
select has_table('public', 'user_ai_work_settings', 'AI work settings table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_ai_work_settings'::regclass),
  'AI work settings enables RLS'
);
select has_column('public', 'tasks', 'cli_assignee', 'tasks store a CLI assignee');
select has_column('public', 'tasks', 'parent_task_id', 'tasks store their parent relationship');
select ok(has_table_privilege('authenticated', 'public.user_ai_work_settings', 'SELECT'), 'authenticated can select settings');
select ok(has_table_privilege('authenticated', 'public.user_ai_work_settings', 'INSERT'), 'authenticated can insert settings');
select ok(has_table_privilege('authenticated', 'public.user_ai_work_settings', 'UPDATE'), 'authenticated can update settings');
select ok(not has_table_privilege('anon', 'public.user_ai_work_settings', 'SELECT'), 'anon cannot read settings');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    insert into public.user_ai_work_settings(user_id, workspace_id, cli_tools)
    values (
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      array['codex'::public.ai_cli_tool]
    )
  $$,
  '23514', null,
  'enabled CLI tools require a working directory'
);
select lives_ok(
  $$
    insert into public.user_ai_work_settings(
      user_id, workspace_id, cli_tools, default_working_path
    ) values (
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      array['codex'::public.ai_cli_tool],
      '/tmp/anttodo-ai-work'
    )
  $$,
  'a member can save their own workspace settings'
);
select is(
  (select default_working_path from public.user_ai_work_settings),
  '/tmp/anttodo-ai-work',
  'settings persist the local working directory'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.user_ai_work_settings),
  0,
  'an outsider cannot read workspace settings'
);
select throws_ok(
  $$
    insert into public.user_ai_work_settings(user_id, workspace_id)
    values (
      '15000000-0000-0000-0000-000000000003',
      '25000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501', null,
  'an outsider cannot create workspace settings'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.user_ai_work_settings),
  0,
  'a workspace member cannot read another member settings'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.assign_task(
    '45000000-0000-0000-0000-000000000001', null, 'claude'
  )$$,
  '42501', 'CLI must be enabled in AI work settings',
  'an unconfigured CLI cannot be assigned to a task'
);
select lives_ok(
  $$select public.assign_task(
    '45000000-0000-0000-0000-000000000001', null, 'codex'
  )$$,
  'an enabled CLI can be assigned to a task'
);
select is(
  (
    select concat_ws('|', coalesce(assignee_id::text, ''), cli_assignee::text)
    from public.tasks where id = '45000000-0000-0000-0000-000000000001'
  ),
  '|codex',
  'task member and CLI assignments are mutually exclusive'
);
select is(
  (
    select payload ->> 'cli_assignee'
    from public.activity_events
    where task_id = '45000000-0000-0000-0000-000000000001'
      and event_type = 'task.assignee_changed'
    order by created_at desc, id desc
    limit 1
  ),
  'codex',
  'task activity records the CLI assignee'
);
select lives_ok(
  $$select public.assign_task(
    '45000000-0000-0000-0000-000000000001',
    '15000000-0000-0000-0000-000000000002', null
  )$$,
  'a valid member assignment replaces the CLI atomically'
);
select is(
  (
    select concat_ws('|', assignee_id::text, coalesce(cli_assignee::text, ''))
    from public.tasks where id = '45000000-0000-0000-0000-000000000001'
  ),
  '15000000-0000-0000-0000-000000000002|',
  'switching to a member clears the task CLI assignee'
);
select throws_ok(
  $$select public.assign_task(
    '45000000-0000-0000-0000-000000000001',
    '15000000-0000-0000-0000-000000000002', 'codex'
  )$$,
  '23514', 'Choose either a member or a CLI assignee',
  'task assignment RPC rejects two targets'
);
select lives_ok(
  $$select public.assign_task(
    '55000000-0000-0000-0000-000000000001', null, 'codex'
  )$$,
  'an enabled CLI can be assigned to a nested task'
);
select is(
  (
    select concat_ws('|', coalesce(assignee_id::text, ''), cli_assignee::text)
    from public.tasks where id = '55000000-0000-0000-0000-000000000001'
  ),
  '|codex',
  'nested task member and CLI assignments are mutually exclusive'
);
select is(
  (
    select payload->>'cli_assignee'
    from public.activity_events
    where task_id = '55000000-0000-0000-0000-000000000001'
      and event_type = 'task.assignee_changed'
    order by created_at desc, id desc
    limit 1
  ),
  'codex',
  'nested task activity records the CLI assignee'
);
select lives_ok(
  $$select public.assign_task(
    '45000000-0000-0000-0000-000000000001', null, 'codex'
  )$$,
  'task can be reassigned to CLI before note conversion'
);
select throws_ok(
  $$update public.tasks set kind = 'note'
    where id = '45000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Notes cannot contain child tasks',
  'a task with descendants cannot become a note'
);
select is(
  (
    select kind::text
    from public.tasks where id = '45000000-0000-0000-0000-000000000001'
  ),
  'todo',
  'failed note conversion leaves the task unchanged'
);
select lives_ok(
  $$update public.tasks set deleted_at=now() where id='55000000-0000-0000-0000-000000000001';
    delete from public.tasks where id='55000000-0000-0000-0000-000000000001'$$,
  'a nested task can be permanently removed before note conversion'
);
select lives_ok(
  $$update public.tasks set kind = 'note'
    where id = '45000000-0000-0000-0000-000000000001'$$,
  'a leaf root can be converted to a note'
);
select is(
  (select (assignee_id is null and cli_assignee is null)::text from public.tasks
   where id='45000000-0000-0000-0000-000000000001'),
  'true','note conversion clears the assignment'
);
select throws_ok(
  $$select public.assign_task(
    '45000000-0000-0000-0000-000000000001', null, 'codex'
  )$$,
  '42501', 'Notes cannot be assigned',
  'notes reject CLI assignment'
);
select throws_ok(
  $$insert into public.tasks(id,workspace_id,parent_task_id,title,created_by) values(
    '55000000-0000-0000-0000-000000000002','25000000-0000-0000-0000-000000000001',
    '45000000-0000-0000-0000-000000000001','Below note','15000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Notes cannot contain child tasks',
  'notes reject nested tasks'
);

select * from finish();
rollback;
