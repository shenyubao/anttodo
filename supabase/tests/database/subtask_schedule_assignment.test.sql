begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('16000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('16000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('16000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subtask-outsider@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('26000000-0000-0000-0000-000000000001', 'Subtask Test', '16000000-0000-0000-0000-000000000001');
insert into public.workspace_members(workspace_id, user_id, role)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'member');
insert into public.tasks(id, workspace_id, title, created_by)
values ('46000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'Parent task', '16000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.subtasks(id, task_id, title, position)
values ('56000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000001', 'Child task', 0);

select has_column('public', 'subtasks', 'due_at', 'subtasks expose a due date');
select has_column('public', 'subtasks', 'assignee_id', 'subtasks expose an assignee');

update public.subtasks
set due_at = '2026-08-28 15:59:59+00', assignee_id = '16000000-0000-0000-0000-000000000002'
where id = '56000000-0000-0000-0000-000000000001';
select is(
  (select due_at from public.subtasks where id = '56000000-0000-0000-0000-000000000001'),
  '2026-08-28 15:59:59+00'::timestamptz,
  'an editable subtask saves its due date'
);
select is(
  (select assignee_id from public.subtasks where id = '56000000-0000-0000-0000-000000000001'),
  '16000000-0000-0000-0000-000000000002'::uuid,
  'a visible workspace member can own a subtask'
);

select throws_like(
  $$update public.subtasks
    set assignee_id = '16000000-0000-0000-0000-000000000003'
    where id = '56000000-0000-0000-0000-000000000001'$$,
  '%must be able to view its parent task%',
  'an outsider cannot be assigned to a subtask'
);

select * from finish();
rollback;
