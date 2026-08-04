begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '14000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'purge-owner@example.com', '',
  now(), '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, created_by)
values (
  '24000000-0000-0000-0000-000000000001',
  'Purge Trash Test',
  '14000000-0000-0000-0000-000000000001'
);

insert into public.tasks(id, workspace_id, title, created_by, deleted_at)
values
  (
    '44000000-0000-0000-0000-000000000001',
    '24000000-0000-0000-0000-000000000001',
    'Expired trash task',
    '14000000-0000-0000-0000-000000000001',
    now() - interval '31 days'
  ),
  (
    '44000000-0000-0000-0000-000000000002',
    '24000000-0000-0000-0000-000000000001',
    'Recent trash task',
    '14000000-0000-0000-0000-000000000001',
    now() - interval '7 days'
  ),
  (
    '44000000-0000-0000-0000-000000000003',
    '24000000-0000-0000-0000-000000000001',
    'Active task',
    '14000000-0000-0000-0000-000000000001',
    null
  );

select is(
  anttodo_private.purge_trashed_tasks(),
  1,
  'purge removes only tasks soft-deleted more than 30 days ago'
);

select is(
  (select count(*)::integer from public.tasks where id = '44000000-0000-0000-0000-000000000001'),
  0,
  'expired trashed task is hard-deleted'
);

select is(
  (select count(*)::integer from public.tasks where id = '44000000-0000-0000-0000-000000000002'),
  1,
  'recently trashed task is retained'
);

select is(
  (select count(*)::integer from public.tasks where id = '44000000-0000-0000-0000-000000000003'),
  1,
  'active task is retained'
);

select * from finish();
rollback;
