begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '11000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'sso-owner@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '11000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'sso-member@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  '11000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'sso-outsider@example.com',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into auth.users (
  id, instance_id, aud, role, phone, encrypted_password,
  phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '11000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', '+8613800138000', '',
  now(), '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
),
(
  '11000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', '8613900139000', '',
  now(), '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
),
(
  '11000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', '13700137000', '',
  now(), '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
);

insert into public.workspaces (id, name, created_by)
values
(
  '21000000-0000-0000-0000-000000000001',
  'SSO Workspace A',
  '11000000-0000-0000-0000-000000000001'
),
(
  '21000000-0000-0000-0000-000000000002',
  'SSO Workspace B',
  '11000000-0000-0000-0000-000000000001'
);

insert into public.workspace_members (workspace_id, user_id, role)
values (
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002',
  'member'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.workspace_sso_providers (
      id, workspace_id, provider, public_config, created_by
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '21000000-0000-0000-0000-000000000001',
      'dingtalk',
      '{"corpId":"dingcorp-a","appKey":"app-key-a"}'::jsonb,
      '11000000-0000-0000-0000-000000000001'
    )
  $$,
  'workspace owner can insert dingtalk SSO config'
);

select is(
  (
    select count(*)::integer
    from public.workspace_sso_providers
    where workspace_id = '21000000-0000-0000-0000-000000000001'
  ),
  1,
  'owner can read workspace SSO config'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from public.workspace_sso_providers
    where workspace_id = '21000000-0000-0000-0000-000000000001'
  ),
  1,
  'workspace member can read SSO config'
);

select throws_ok(
  $$
    insert into public.workspace_sso_providers (
      workspace_id, provider, public_config, created_by
    ) values (
      '21000000-0000-0000-0000-000000000001',
      'dingtalk',
      '{"corpId":"dingcorp-dup","appKey":"app-key-dup"}'::jsonb,
      '11000000-0000-0000-0000-000000000002'
    )
  $$,
  '42501',
  NULL,
  'workspace member cannot insert SSO config'
);

select lives_ok(
  $$
    update public.workspace_sso_providers
    set enabled = false
    where id = '31000000-0000-0000-0000-000000000001'
  $$,
  'workspace member update attempt does not raise'
);

select is(
  (
    select enabled
    from public.workspace_sso_providers
    where id = '31000000-0000-0000-0000-000000000001'
  ),
  true,
  'workspace member cannot disable SSO config under RLS'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from public.workspace_sso_providers
    where workspace_id = '21000000-0000-0000-0000-000000000001'
  ),
  0,
  'outsider cannot read SSO config'
);

reset role;

select is(
  public.set_sso_provider_secret(
    '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'super-secret-value'
  ),
  '••••alue',
  'vault secret helper stores hint from last four characters'
);

select is(
  public.get_sso_provider_secret('31000000-0000-0000-0000-000000000001'),
  'super-secret-value',
  'service role can read decrypted SSO secret'
);

select throws_ok(
  $$
    select public.set_sso_provider_secret(
      '31000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000002',
      'member-secret'
    )
  $$,
  'P0001',
  'SSO administrator access required',
  'member cannot save SSO secret via vault RPC'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.workspace_sso_providers (
      workspace_id, provider, public_config, created_by, enabled
    ) values (
      '21000000-0000-0000-0000-000000000002',
      'dingtalk',
      '{"corpId":"dingcorp-b","appKey":"app-key-b"}'::jsonb,
      '11000000-0000-0000-0000-000000000001',
      true
    )
  $$,
  'owner can configure SSO on a second workspace'
);

select throws_ok(
  $$
    update public.workspace_sso_providers
    set public_config = '{"corpId":"dingcorp-a","appKey":"app-key-b2"}'::jsonb
    where workspace_id = '21000000-0000-0000-0000-000000000002'
  $$,
  '23505',
  NULL,
  'enabled dingtalk corpId must be unique across workspaces'
);

reset role;

select ok(
  public.delete_sso_provider_secret(
    '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001'
  ),
  'owner can delete SSO secret via vault RPC'
);

select is(
  anttodo_private.find_user_id_by_phone('+8613800138000'),
  '11000000-0000-0000-0000-000000000004'::uuid,
  'find_user_id_by_phone matches exact E.164 phone'
);

select is(
  anttodo_private.find_user_id_by_phone('+8613900139000'),
  '11000000-0000-0000-0000-000000000005'::uuid,
  'find_user_id_by_phone matches 86-prefixed stored phone'
);

select is(
  anttodo_private.find_user_id_by_phone('+8613700137000'),
  '11000000-0000-0000-0000-000000000006'::uuid,
  'find_user_id_by_phone matches local 11-digit stored phone'
);

select is(
  anttodo_private.find_user_id_by_phone('+8613100131000'),
  null,
  'find_user_id_by_phone returns null for unknown phone'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_sso_auth_handoff(text, uuid, text, timestamptz)',
    'EXECUTE'
  ),
  'anonymous callers cannot create desktop SSO handoffs'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_sso_auth_handoff(text)',
    'EXECUTE'
  ),
  'authenticated callers cannot consume desktop SSO handoffs directly'
);

select lives_ok(
  $$
    select public.create_sso_auth_handoff(
      repeat('a', 64),
      '21000000-0000-0000-0000-000000000001',
      'server-only-token-hash',
      now() + interval '2 minutes'
    )
  $$,
  'service-side RPC creates a desktop SSO handoff'
);

select is(
  (
    select count(*)::integer
    from anttodo_private.sso_auth_handoffs
    where code_hash = repeat('a', 64)
      and token_hash = 'server-only-token-hash'
  ),
  1,
  'handoff stores only the supplied code hash and server token hash'
);

select results_eq(
  $$
    select status, workspace_id, token_hash
    from public.consume_sso_auth_handoff(repeat('a', 64))
  $$,
  $$ values (
    'ok'::text,
    '21000000-0000-0000-0000-000000000001'::uuid,
    'server-only-token-hash'::text
  ) $$,
  'desktop SSO handoff can be consumed once'
);

select is(
  (
    select status
    from public.consume_sso_auth_handoff(repeat('a', 64))
  ),
  'consumed',
  'desktop SSO handoff rejects a second consumption'
);

select lives_ok(
  $$
    select public.create_sso_auth_handoff(
      repeat('b', 64),
      '21000000-0000-0000-0000-000000000001',
      'expired-token-hash',
      now() + interval '2 minutes'
    );
    update anttodo_private.sso_auth_handoffs
    set expires_at = now() - interval '1 second'
    where code_hash = repeat('b', 64);
  $$,
  'test fixture creates an expired desktop SSO handoff'
);

select is(
  (
    select status
    from public.consume_sso_auth_handoff(repeat('b', 64))
  ),
  'expired',
  'expired desktop SSO handoff cannot be consumed'
);

select * from finish();
rollback;
