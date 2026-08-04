begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('anttodo_private', 'cli_device_authorizations', 'device authorization table exists privately');
select isnt_empty(
  $$select relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'anttodo_private' and c.relname = 'cli_device_authorizations' and relrowsecurity$$,
  'device authorization table enables RLS'
);
select ok(not has_table_privilege('anon', 'anttodo_private.cli_device_authorizations', 'SELECT'), 'anon cannot read device authorizations');
select ok(not has_table_privilege('authenticated', 'anttodo_private.cli_device_authorizations', 'SELECT'), 'authenticated cannot read device authorizations');
select ok(not has_function_privilege('anon', 'public.cli_device_auth_init(text,text,jsonb,jsonb)', 'EXECUTE'), 'anon cannot call init RPC');
select ok(not has_function_privilege('authenticated', 'public.cli_device_auth_poll(uuid,text)', 'EXECUTE'), 'authenticated cannot call poll RPC');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'cli-auth@example.com', '', now(), '{}', '{}', now(), now()
);

set local role service_role;

create temporary table cli_request as
select * from public.cli_device_auth_init(
  repeat('a', 64), repeat('b', 64),
  '{"kty":"EC","crv":"P-256","x":"x","y":"y"}'::jsonb,
  '{"name":"AntTodo CLI"}'::jsonb
);

select is((select count(*)::integer from cli_request), 1, 'service role can initiate a device authorization');
select is(
  (select status from public.cli_device_auth_inspect(repeat('b', 64))),
  'pending',
  'user code inspects a pending request'
);
select ok(public.cli_device_auth_approve(
  (select request_id from cli_request), repeat('b', 64),
  '81000000-0000-0000-0000-000000000001',
  '{"ephemeralPublicKey":{"kty":"EC","crv":"P-256","x":"x","y":"y"},"salt":"s","iv":"i","ciphertext":"c"}'::jsonb
), 'pending request can be approved once');
select ok(not public.cli_device_auth_approve(
  (select request_id from cli_request), repeat('b', 64),
  '81000000-0000-0000-0000-000000000001', '{}'::jsonb
), 'approved request cannot be approved twice');
select is(
  (select count(*)::integer from public.cli_device_auth_poll(
    (select request_id from cli_request), repeat('c', 64)
  )),
  0,
  'an incorrect device secret cannot poll a request'
);
select is(
  (select status from public.cli_device_auth_poll((select request_id from cli_request), repeat('a', 64))),
  'approved',
  'device secret polls the approved request'
);
select is(
  (select status from public.cli_device_auth_poll((select request_id from cli_request), repeat('a', 64))),
  'slow_down',
  'rapid polling is rate limited atomically'
);
select ok(public.cli_device_auth_consume(
  (select request_id from cli_request), repeat('a', 64)
), 'approved request can be consumed once');
select ok(not public.cli_device_auth_consume(
  (select request_id from cli_request), repeat('a', 64)
), 'consumed request cannot be consumed twice');

create temporary table cli_denied_request as
select * from public.cli_device_auth_init(
  repeat('d', 64), repeat('e', 64),
  '{"kty":"EC","crv":"P-256","x":"x","y":"y"}'::jsonb,
  '{}'::jsonb
);
select ok(public.cli_device_auth_deny(
  (select request_id from cli_denied_request), repeat('e', 64),
  '81000000-0000-0000-0000-000000000001'
), 'pending request can be denied once');
select is(
  (select status from public.cli_device_auth_poll(
    (select request_id from cli_denied_request), repeat('d', 64)
  )),
  'denied',
  'the device observes denial without receiving a session'
);

create temporary table cli_expired_request as
select * from public.cli_device_auth_init(
  repeat('f', 64), repeat('0', 64),
  '{"kty":"EC","crv":"P-256","x":"x","y":"y"}'::jsonb,
  '{}'::jsonb
);
update anttodo_private.cli_device_authorizations
set expires_at = now() - interval '1 second'
where id = (select request_id from cli_expired_request);
select is(
  (select status from public.cli_device_auth_poll(
    (select request_id from cli_expired_request), repeat('f', 64)
  )),
  'expired',
  'an expired request cannot transition or reveal a session'
);
select ok(
  anttodo_private.purge_cli_device_authorizations() >= 1,
  'expired requests are purged'
);
reset role;
select ok(
  exists(select 1 from cron.job where jobname = 'anttodo-purge-cli-device-auth'),
  'pg_cron schedules expired device authorization cleanup'
);

select * from finish();
rollback;
