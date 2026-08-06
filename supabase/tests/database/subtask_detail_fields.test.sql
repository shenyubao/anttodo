begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('16100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-detail-owner@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('26100000-0000-0000-0000-000000000001', 'Subtask Detail Test', '16100000-0000-0000-0000-000000000001');
insert into public.tasks(id, workspace_id, title, created_by)
values ('46100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000001', 'Parent task', '16100000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"16100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.subtasks(id, task_id, title, position)
values ('56100000-0000-0000-0000-000000000001', '46100000-0000-0000-0000-000000000001', 'Child task', 0);

select has_column('public', 'subtasks', 'description', 'subtasks expose description');
select has_column('public', 'subtasks', 'estimate_hours', 'subtasks expose estimate hours');
select has_column('public', 'subtasks', 'actual_hours', 'subtasks expose actual hours');
select has_column('public', 'task_comments', 'subtask_id', 'task comments can target a subtask');

update public.subtasks
set description = '子任务说明',
    estimate_hours = 1.5,
    actual_hours = 0.5
where id = '56100000-0000-0000-0000-000000000001';

select is(
  (select description from public.subtasks where id = '56100000-0000-0000-0000-000000000001'),
  '子任务说明',
  'subtask description can be updated'
);
select is(
  (select estimate_hours from public.subtasks where id = '56100000-0000-0000-0000-000000000001'),
  1.5::numeric,
  'subtask estimate hours can be updated'
);
select is(
  (select actual_hours from public.subtasks where id = '56100000-0000-0000-0000-000000000001'),
  0.5::numeric,
  'subtask actual hours can be updated'
);

select lives_ok(
  $$
    select public.create_task_comment(
      '46100000-0000-0000-0000-000000000001',
      '子任务评论',
      array[]::text[],
      array[]::uuid[],
      '56100000-0000-0000-0000-000000000001'
    )
  $$,
  'create_task_comment accepts subtask_id'
);

select * from finish();
rollback;
