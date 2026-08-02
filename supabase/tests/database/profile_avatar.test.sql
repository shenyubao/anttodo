begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '91000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'avatar-owner@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '92000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'avatar-member@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.workspaces (id, name, created_by)
values (
  '93000000-0000-4000-8000-000000000003',
  'Profile Test Workspace',
  '91000000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (workspace_id, user_id, role)
values (
  '93000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000002',
  'member'
);

select is(
  (select public from storage.buckets where id = 'profile-avatars'),
  true,
  'profile avatar bucket is public'
);
select is(
  (select file_size_limit from storage.buckets where id = 'profile-avatars'),
  2097152::bigint,
  'profile avatar bucket enforces a 2MB limit'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'profile-avatars'),
  array['image/webp']::text[],
  'profile avatar bucket stores normalized WebP images only'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'profile_avatars_%_self'
  ),
  3,
  'profile avatars define self-only insert, update, and delete policies'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'profile-avatars',
      '91000000-0000-4000-8000-000000000001/94000000-0000-4000-8000-000000000004.webp',
      '91000000-0000-4000-8000-000000000001'
    )
  $$,
  'a user can upload an avatar in their own folder'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'profile-avatars',
      '92000000-0000-4000-8000-000000000002/95000000-0000-4000-8000-000000000005.webp',
      '91000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'a user cannot upload an avatar in another user folder'
);
select lives_ok(
  $$
    update storage.objects
    set metadata = '{"cacheControl":"31536000"}'::jsonb
    where bucket_id = 'profile-avatars'
      and name = '91000000-0000-4000-8000-000000000001/94000000-0000-4000-8000-000000000004.webp'
  $$,
  'a user can update an avatar in their own folder'
);
select lives_ok(
  $$
    update public.profiles
    set display_name = '自定义昵称', display_name_customized_at = now()
    where id = '91000000-0000-4000-8000-000000000001'
  $$,
  'a user can customize their own display name'
);
select throws_ok(
  $$
    update public.profiles
    set display_name = '   '
    where id = '91000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'display names cannot be blank'
);
update public.profiles
set display_name = '越权修改'
where id = '92000000-0000-4000-8000-000000000002';
select is(
  (
    select display_name
    from public.profiles
    where id = '92000000-0000-4000-8000-000000000002'
  ),
  'avatar-member',
  'a user cannot update another member profile'
);

select * from finish();
rollback;
