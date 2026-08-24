begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '1a080000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'label-limit-owner@example.com', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
), (
  '1a080000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'label-limit-outsider@example.com', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.workspaces(id, name, created_by)
values (
  '2a080000-0000-0000-0000-000000000001',
  'Label Limit Workspace',
  '1a080000-0000-0000-0000-000000000001'
);

insert into public.labels(
  id, workspace_id, name, kind, view_scope, manage_scope, inherit_permissions, created_by
) values (
  '3a080000-0000-0000-0000-000000000001',
  '2a080000-0000-0000-0000-000000000001',
  '容量标签', 'team', 'all', 'all', false,
  '1a080000-0000-0000-0000-000000000001'
), (
  '3a080000-0000-0000-0000-000000000002',
  '2a080000-0000-0000-0000-000000000001',
  '空标签', 'team', 'all', 'all', false,
  '1a080000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"1a080000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select task_count
    from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')
    where label_id = '3a080000-0000-0000-0000-000000000001'
  ),
  0,
  'visible labels start with a cached count of zero'
);

select lives_ok(
  $$select public.create_task_with_labels(
    '2a080000-0000-0000-0000-000000000001',
    'counted task',
    array['3a080000-0000-0000-0000-000000000001'::uuid]
  )$$,
  'creating a labeled task is allowed under the limit'
);

select is(
  (
    select task_count
    from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')
    where label_id = '3a080000-0000-0000-0000-000000000001'
  ),
  1,
  'creating a labeled task increments the cached count'
);

insert into public.tasks(
  id, workspace_id, title, created_by
) values (
  '4a080000-0000-0000-0000-000000000001',
  '2a080000-0000-0000-0000-000000000001',
  'inbox then labeled',
  '1a080000-0000-0000-0000-000000000001'
);

insert into public.task_labels(task_id, label_id)
values (
  '4a080000-0000-0000-0000-000000000001',
  '3a080000-0000-0000-0000-000000000001'
);

select is(
  (
    select task_count
    from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')
    where label_id = '3a080000-0000-0000-0000-000000000001'
  ),
  2,
  'associating a label with an existing task increments the cached count'
);

update public.tasks
set deleted_at = now()
where id = '4a080000-0000-0000-0000-000000000001';

select is(
  (
    select task_count
    from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')
    where label_id = '3a080000-0000-0000-0000-000000000001'
  ),
  1,
  'trashing a labeled task decrements the cached count'
);

update public.tasks
set deleted_at = null
where id = '4a080000-0000-0000-0000-000000000001';

select is(
  (
    select task_count
    from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')
    where label_id = '3a080000-0000-0000-0000-000000000001'
  ),
  2,
  'restoring a labeled task restores the cached count'
);

delete from public.task_labels
where task_id = '4a080000-0000-0000-0000-000000000001';

select is(
  (
    select task_count
    from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')
    where label_id = '3a080000-0000-0000-0000-000000000001'
  ),
  1,
  'removing a label association decrements the cached count'
);

set local role postgres;
insert into anttodo_private.label_task_counts(label_id, task_count)
values ('3a080000-0000-0000-0000-000000000001', 10000)
on conflict (label_id) do update set task_count = excluded.task_count;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"1a080000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$insert into public.task_labels(task_id, label_id)
    values (
      '4a080000-0000-0000-0000-000000000001',
      '3a080000-0000-0000-0000-000000000001'
    )$$,
  'P0001',
  'label_task_limit_exceeded',
  'associating a task is rejected once a label already has 10000 live tasks'
);

select throws_ok(
  $$select public.create_task_with_labels(
    '2a080000-0000-0000-0000-000000000001',
    'overflow task',
    array['3a080000-0000-0000-0000-000000000001'::uuid]
  )$$,
  'P0001',
  'label_task_limit_exceeded',
  'creating a task is rejected once a label already has 10000 live tasks'
);

select is(
  (
    select task_count
    from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')
    where label_id = '3a080000-0000-0000-0000-000000000001'
  ),
  10000,
  'rejected associations do not change the cached count'
);

select lives_ok(
  $$select public.create_task_with_labels(
    '2a080000-0000-0000-0000-000000000001',
    'inbox task',
    array[]::uuid[]
  )$$,
  'unlabeled inbox tasks are not limited by the per-label cap'
);

insert into public.task_labels(task_id, label_id)
values (
  '4a080000-0000-0000-0000-000000000001',
  '3a080000-0000-0000-0000-000000000002'
);

select lives_ok(
  $$delete from public.labels where id = '3a080000-0000-0000-0000-000000000002'$$,
  'deleting a label with associations does not fail count maintenance'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"1a080000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select throws_ok(
  $$select * from public.list_label_task_counts('2a080000-0000-0000-0000-000000000001')$$,
  'P0001',
  'not authorized',
  'non-members cannot read cached label task counts'
);

select * from finish();
rollback;
