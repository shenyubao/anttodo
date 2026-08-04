begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '14200000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'purge-user-owner@example.com', '',
  now(), '{}', '{}', now(), now()
),
(
  '14200000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'purge-user-outsider@example.com', '',
  now(), '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, created_by)
values (
  '24200000-0000-0000-0000-000000000001',
  'Purge By User Test',
  '14200000-0000-0000-0000-000000000001'
);

insert into public.tasks(id, workspace_id, title, created_by, deleted_at)
values
  (
    '44200000-0000-0000-0000-000000000001',
    '24200000-0000-0000-0000-000000000001',
    'Trashed task',
    '14200000-0000-0000-0000-000000000001',
    now() - interval '1 day'
  ),
  (
    '44200000-0000-0000-0000-000000000002',
    '24200000-0000-0000-0000-000000000001',
    'Active task',
    '14200000-0000-0000-0000-000000000001',
    null
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14200000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$ delete from public.tasks where id = '44200000-0000-0000-0000-000000000001' $$,
  'editor can permanently delete a trashed task'
);

select is(
  (select count(*)::integer from public.tasks where id = '44200000-0000-0000-0000-000000000001'),
  0,
  'trashed task is hard-deleted'
);

select lives_ok(
  $$ delete from public.tasks where id = '44200000-0000-0000-0000-000000000002' $$,
  'hard-delete attempt on an active task does not error'
);

select is(
  (select count(*)::integer from public.tasks where id = '44200000-0000-0000-0000-000000000002'),
  1,
  'active tasks cannot be hard-deleted by users'
);

set local role service_role;
insert into public.tasks(id, workspace_id, title, created_by, deleted_at)
values (
  '44200000-0000-0000-0000-000000000003',
  '24200000-0000-0000-0000-000000000001',
  'Another trashed task',
  '14200000-0000-0000-0000-000000000001',
  now() - interval '1 day'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14200000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$ delete from public.tasks where id = '44200000-0000-0000-0000-000000000003' $$,
  'outsider hard-delete attempt does not error'
);

set local role service_role;
select is(
  (select count(*)::integer from public.tasks where id = '44200000-0000-0000-0000-000000000003'),
  1,
  'outsider cannot hard-delete a trashed task'
);

select * from finish();
rollback;
