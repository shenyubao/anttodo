begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '16000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-feature-one@example.com', '', now(), '{}', '{}', now(), now()
),
(
  '16000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-feature-two@example.com', '', now(), '{}', '{}', now(), now()
);

insert into public.user_ai_feature_settings (
  user_id,
  smart_format_enabled,
  smart_format_prompt_override
) values (
  '16000000-0000-0000-0000-000000000002',
  false,
  '另一个用户的提示词'
);

select has_table('public', 'user_ai_feature_settings', 'AI feature settings table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_ai_feature_settings'::regclass),
  'AI feature settings enables RLS'
);
select has_column(
  'public', 'user_ai_feature_settings', 'smart_format_enabled',
  'AI feature settings expose the smart format switch'
);
select has_column(
  'public', 'user_ai_feature_settings', 'smart_format_prompt_override',
  'AI feature settings expose the smart format prompt override'
);
select hasnt_column(
  'public', 'user_ai_feature_settings', 'task_decompose_enabled',
  'AI feature settings do not expose the removed task decompose switch'
);
select hasnt_column(
  'public', 'user_ai_feature_settings', 'task_decompose_prompt_override',
  'AI feature settings do not expose the removed task decompose prompt override'
);
select ok(has_table_privilege('authenticated', 'public.user_ai_feature_settings', 'SELECT'));
select ok(has_table_privilege('authenticated', 'public.user_ai_feature_settings', 'INSERT'));
select ok(has_table_privilege('authenticated', 'public.user_ai_feature_settings', 'UPDATE'));
select ok(not has_table_privilege('authenticated', 'public.user_ai_feature_settings', 'DELETE'));
select ok(not has_table_privilege('anon', 'public.user_ai_feature_settings', 'SELECT'));

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$insert into public.user_ai_feature_settings(user_id)
    values ('16000000-0000-0000-0000-000000000001')$$,
  'a user can create their own global AI feature settings'
);
select is(
  (select smart_format_enabled from public.user_ai_feature_settings),
  true,
  'smart formatting defaults to enabled'
);
select is(
  (select count(*)::integer from public.user_ai_feature_settings),
  1,
  'a user can only read their own settings'
);

select lives_ok(
  $$update public.user_ai_feature_settings
    set smart_format_enabled = false,
        smart_format_prompt_override = '按用户规则整理任务'
    where user_id = '16000000-0000-0000-0000-000000000001'$$,
  'a user can update their own settings'
);
select is(
  (select smart_format_prompt_override from public.user_ai_feature_settings),
  '按用户规则整理任务',
  'prompt overrides persist'
);
select throws_ok(
  $$update public.user_ai_feature_settings
    set smart_format_prompt_override = '   '
    where user_id = '16000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'blank prompt overrides are rejected'
);
select throws_ok(
  $$insert into public.user_ai_feature_settings(user_id)
    values ('16000000-0000-0000-0000-000000000002')
    on conflict (user_id) do update
      set smart_format_enabled = excluded.smart_format_enabled$$,
  '42501', null,
  'a user cannot write another user settings'
);

select * from finish();
rollback;
