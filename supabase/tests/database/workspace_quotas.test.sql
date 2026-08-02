begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('17000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('17000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota-other@example.com', '', now(), '{}', '{}', now(), now());

select is(
  (select workspace_limit from public.user_quotas where user_id = '17000000-0000-0000-0000-000000000001'),
  3,
  'new users receive the default workspace quota'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is((select count(*)::integer from public.user_quotas), 1, 'users can read only their own quota');
select throws_ok(
  $$update public.user_quotas set workspace_limit = 9 where user_id = '17000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'users cannot edit their own quota'
);

select lives_ok(
  $$insert into public.workspaces (id, name, slug, created_by) values
    ('27000000-0000-0000-0000-000000000001', 'Quota One', 'quota-one', '17000000-0000-0000-0000-000000000001'),
    ('27000000-0000-0000-0000-000000000002', 'Quota Two', 'quota-two', '17000000-0000-0000-0000-000000000001'),
    ('27000000-0000-0000-0000-000000000003', 'Quota Three', 'quota-three', '17000000-0000-0000-0000-000000000001')$$,
  'a user can create workspaces up to the quota'
);

select throws_ok(
  $$insert into public.workspaces (id, name, slug, created_by) values
    ('27000000-0000-0000-0000-000000000004', 'Quota Four', 'quota-four', '17000000-0000-0000-0000-000000000001')$$,
  'P0001', 'workspace_owner_quota_exceeded',
  'a fourth owned workspace is rejected'
);

set local role postgres;
insert into public.workspace_members (workspace_id, user_id, role)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'admin');

insert into public.workspaces (id, name, slug, created_by)
values (
  '27000000-0000-0000-0000-000000000005',
  'Ownership Transfer',
  'ownership-transfer',
  '17000000-0000-0000-0000-000000000002'
);
insert into public.workspace_members (workspace_id, user_id, role)
values ('27000000-0000-0000-0000-000000000005', '17000000-0000-0000-0000-000000000001', 'member');

select throws_ok(
  $$update public.workspace_members set role = 'owner'
    where workspace_id = '27000000-0000-0000-0000-000000000005'
      and user_id = '17000000-0000-0000-0000-000000000001'$$,
  'P0001', 'workspace_owner_quota_exceeded',
  'ownership acquisition cannot bypass the quota'
);

select lives_ok(
  $$update public.workspace_members set role = 'owner'
    where workspace_id = '27000000-0000-0000-0000-000000000001'
      and user_id = '17000000-0000-0000-0000-000000000001'$$,
  'keeping an existing owner does not consume quota again'
);

set local role authenticated;
select throws_ok(
  $$select public.delete_workspace_owned(
    '27000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0000-000000000001',
    'Quota One'
  )$$,
  '42501', null,
  'authenticated clients cannot call the privileged delete function'
);

set local role service_role;
select throws_ok(
  $$select public.delete_workspace_owned(
    '27000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0000-000000000001',
    'Wrong Name'
  )$$,
  '22023', 'workspace_confirmation_mismatch',
  'workspace deletion requires the exact confirmation name'
);
select throws_ok(
  $$select public.delete_workspace_owned(
    '27000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0000-000000000002',
    'Quota One'
  )$$,
  '42501', 'workspace_owner_required',
  'workspace administrators cannot delete a workspace'
);

set local role postgres;
with secret as (
  select vault.create_secret('quota-test-secret', 'workspace-quota-test') as id
)
insert into public.connector_instances (
  id, workspace_id, type, name, credential_secret_id, created_by
)
select
  '57000000-0000-0000-0000-000000000001',
  '27000000-0000-0000-0000-000000000001',
  'mock',
  'Quota connector',
  secret.id,
  '17000000-0000-0000-0000-000000000001'
from secret;

set local role service_role;
select ok(
  public.delete_workspace_owned(
    '27000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0000-000000000001',
    'Quota One'
  ),
  'workspace owners can delete their workspace through the privileged function'
);

set local role postgres;
select is(
  (select count(*)::integer from vault.secrets where description = 'workspace-quota-test'),
  0,
  'workspace deletion removes connector Vault secrets'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select lives_ok(
  $$insert into public.workspaces (id, name, slug, created_by) values
    ('27000000-0000-0000-0000-000000000004', 'Quota Four', 'quota-four', '17000000-0000-0000-0000-000000000001')$$,
  'deleting a workspace releases ownership quota'
);

select is(
  (select count(*)::integer from public.workspace_members where user_id = '17000000-0000-0000-0000-000000000001' and role = 'owner'),
  3,
  'the user owns at most the configured number of workspaces'
);

select * from finish();
rollback;
