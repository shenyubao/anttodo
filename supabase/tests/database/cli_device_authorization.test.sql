begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

select has_table('anttodo_private', 'cli_device_authorizations', 'device authorization requests remain private');
select has_table('anttodo_private', 'cli_credentials', 'CLI credentials exist privately');
select ok((select relrowsecurity from pg_class where oid = 'anttodo_private.cli_device_authorizations'::regclass), 'authorization requests enable RLS');
select ok((select relrowsecurity from pg_class where oid = 'anttodo_private.cli_credentials'::regclass), 'credentials enable RLS');
select ok(not has_table_privilege('anon', 'anttodo_private.cli_credentials', 'SELECT'), 'anon cannot read credentials');
select ok(not has_table_privilege('authenticated', 'anttodo_private.cli_credentials', 'SELECT'), 'authenticated cannot read credentials');
select ok(not has_function_privilege('anon', 'public.cli_device_auth_init_v2(text,text,jsonb)', 'EXECUTE'), 'anon cannot call v2 init RPC');
select ok(not has_function_privilege('authenticated', 'public.cli_device_auth_list_v2(uuid)', 'EXECUTE'), 'authenticated cannot call device list RPC directly');

select is(anttodo_private.cli_expiry('7', '2026-01-01Z')::date, '2026-01-08'::date, '7-day expiry is accepted');
select is(anttodo_private.cli_expiry('90', '2026-01-01Z')::date, '2026-04-01'::date, '90-day expiry is accepted');
select is(anttodo_private.cli_expiry('360', '2026-01-01Z')::date, '2026-12-27'::date, '360-day expiry is accepted');
select is(anttodo_private.cli_expiry('unlimited', '2026-01-01Z'), null, 'unlimited has no credential expiry');
select is(anttodo_private.cli_expiry('invalid', '2026-01-01Z'), 'infinity'::timestamptz, 'invalid duration is rejected by its sentinel');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cli-one@example.com', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cli-two@example.com', '', now(), '{}', '{}', now(), now());

insert into anttodo_private.cli_oauth_clients(client_id)
values ('82000000-0000-4000-8000-000000000001');

set local role service_role;

create temporary table cli_request as
select * from public.cli_device_auth_init_v2(repeat('a', 64), repeat('b', 64), '{"name":"AntTodo CLI","hostname":"macbook","version":"2.0.0"}');
select is((select count(*)::integer from cli_request), 1, 'service role initializes protocol v2');
select is((select status from public.cli_device_auth_inspect_v2(repeat('b', 64))), 'pending', 'user code inspects a pending v2 request');

create temporary table cli_authorized as
select * from public.cli_device_auth_authorize_v2(
  (select request_id from cli_request), repeat('b', 64),
  '81000000-0000-4000-8000-000000000001', '360', repeat('c', 64), repeat('d', 64), repeat('v', 43)
);
select is((select count(*)::integer from cli_authorized), 1, 'one explicit approval starts OAuth');
select is((select count(*)::integer from public.cli_device_auth_authorize_v2(
  (select request_id from cli_request), repeat('b', 64),
  '81000000-0000-4000-8000-000000000001', '7', repeat('e', 64), repeat('f', 64), repeat('w', 43)
)), 0, 'approval intent is single-use');
select ok(exists(
  select 1 from vault.decrypted_secrets secret
  join anttodo_private.cli_device_authorizations request on request.pkce_verifier_secret_id = secret.id
  where request.id = (select request_id from cli_request) and secret.decrypted_secret = repeat('v', 43)
), 'PKCE verifier is stored only in Vault');

reset role;
select is(
  ((anttodo_private.cli_access_token_hook('{"claims":{"client_id":"82000000-0000-4000-8000-000000000001","iat":1000,"exp":4600}}'))->'claims'->>'exp')::integer,
  1900,
  'CLI OAuth access JWT is capped at 15 minutes'
);
select is(
  ((anttodo_private.cli_access_token_hook('{"claims":{"client_id":"82000000-0000-4000-8000-000000000002","iat":1000,"exp":4600}}'))->'claims'->>'exp')::integer,
  4600,
  'non-CLI sessions keep their configured JWT lifetime'
);
set local role service_role;

select ok(public.cli_device_auth_complete_v2(
  (select request_id from cli_request),
  '81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  now() + interval '15 minutes',
  '{"access_token":"access-one","refresh_token":"refresh-one"}'
), 'OAuth callback creates the device credential');
select is((select credential_hash from anttodo_private.cli_credentials where id = (select request_id from cli_request)), repeat('a', 64), 'database stores only the SHA-256 credential hash');
select ok(not exists(
  select 1 from anttodo_private.cli_credentials where client_metadata::text like '%refresh-one%'
), 'credential row never contains OAuth tokens');
select is((select status from public.cli_device_auth_poll_v2((select request_id from cli_request), repeat('a', 64))), 'approved', 'device observes OAuth completion');
select is((select status from public.cli_device_auth_poll_v2((select request_id from cli_request), repeat('a', 64))), 'slow_down', 'polling is atomically rate limited');
select ok(public.cli_device_auth_consume_v2((select request_id from cli_request), repeat('a', 64)), 'approved request is consumed once');

create temporary table cached_exchange as
select * from public.cli_device_auth_exchange_v2((select request_id from cli_request), repeat('a', 64), '84000000-0000-4000-8000-000000000001');
select ok(not (select refresh_required from cached_exchange), 'access token with at least 60 seconds is reused');

update anttodo_private.cli_credentials set access_expires_at = now() + interval '30 seconds'
where id = (select request_id from cli_request);
create temporary table first_lease as
select * from public.cli_device_auth_exchange_v2((select request_id from cli_request), repeat('a', 64), '84000000-0000-4000-8000-000000000002');
select ok((select refresh_required and lease_acquired from first_lease), 'first refresher atomically receives a 30-second lease');
create temporary table second_lease as
select * from public.cli_device_auth_exchange_v2((select request_id from cli_request), repeat('a', 64), '84000000-0000-4000-8000-000000000003');
select ok((select refresh_required and not lease_acquired from second_lease), 'concurrent refresher receives retry state');
select ok(public.cli_device_auth_refresh_v2(
  (select request_id from cli_request), '84000000-0000-4000-8000-000000000002', now() + interval '15 minutes',
  '{"access_token":"access-two","refresh_token":"refresh-two"}'
), 'lease owner rotates the refresh bundle');
select ok(exists(
  select 1 from vault.decrypted_secrets secret
  join anttodo_private.cli_credentials credential on credential.oauth_bundle_secret_id = secret.id
  where credential.id = (select request_id from cli_request) and secret.decrypted_secret like '%refresh-two%'
), 'rotated refresh token replaces the Vault bundle');

select is((select count(*)::integer from public.cli_device_auth_list_v2('81000000-0000-4000-8000-000000000001')), 1, 'owner device list contains the active credential');
select is((select count(*)::integer from public.cli_device_auth_list_v2('81000000-0000-4000-8000-000000000002')), 0, 'another user device list is isolated');
select ok(not public.cli_device_auth_revoke_v2((select request_id from cli_request), '81000000-0000-4000-8000-000000000002', null), 'another user cannot revoke the device');
select ok(public.cli_device_auth_revoke_v2((select request_id from cli_request), '81000000-0000-4000-8000-000000000001', null), 'owner revokes one device');
select ok(not exists(
  select 1 from vault.decrypted_secrets secret
  join anttodo_private.cli_credentials credential on credential.oauth_bundle_secret_id = secret.id
  where credential.id = (select request_id from cli_request)
), 'device revocation deletes its Vault bundle');

reset role;
select ok(exists(select 1 from cron.job where jobname = 'anttodo-purge-cli-auth-v2'), 'pg_cron schedules expired credential and orphan cleanup');

select * from finish();
rollback;
