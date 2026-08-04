begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('96000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-owner@example.com', '', now(), '{}', '{}', now(), now()),
  ('96000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-member@example.com', '', now(), '{}', '{}', now(), now()),
  ('96000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-viewer@example.com', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, created_by)
values ('97000000-0000-0000-0000-000000000001', 'Label order', '96000000-0000-0000-0000-000000000001');

insert into public.workspace_members(workspace_id, user_id, role) values
  ('97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 'member'),
  ('97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000003', 'member');

insert into public.labels(
  id, workspace_id, parent_id, name, kind, view_scope, manage_scope,
  inherit_permissions, position, created_by
) values
  ('98000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', null, 'Root A', 'team', 'all', 'users', false, 0, '96000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', null, 'Root B', 'team', 'all', 'users', false, 1, '96000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 'Child 1', 'team', 'inherit', 'inherit', true, 0, '96000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 'Child 2', 'team', 'inherit', 'inherit', true, 1, '96000000-0000-0000-0000-000000000001');

-- Member without parent manage cannot reorder children.
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.reorder_child_labels(
    '98000000-0000-0000-0000-000000000001',
    array['98000000-0000-0000-0000-000000000004','98000000-0000-0000-0000-000000000003']::uuid[]
  )$$,
  '42501',
  'Parent label management permission required',
  'viewer cannot reorder child labels'
);

-- Owner can reorder children.
set local role postgres;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.reorder_child_labels(
    '98000000-0000-0000-0000-000000000001',
    array['98000000-0000-0000-0000-000000000004','98000000-0000-0000-0000-000000000003']::uuid[]
  )$$,
  'owner can reorder child labels'
);
select is(
  (select position from public.labels where id = '98000000-0000-0000-0000-000000000004'),
  0,
  'first child position becomes 0'
);
select is(
  (select position from public.labels where id = '98000000-0000-0000-0000-000000000003'),
  1,
  'second child position becomes 1'
);

-- Members can set personal top-level order independently.
set local role postgres;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.set_user_top_level_label_order(
    '97000000-0000-0000-0000-000000000001',
    array['98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000001']::uuid[]
  )$$,
  'member can set personal top-level order'
);

set local role postgres;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.set_user_top_level_label_order(
    '97000000-0000-0000-0000-000000000001',
    array['98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002']::uuid[]
  )$$,
  'another member can set a different personal order'
);

set local role postgres;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(
  (
    select array_agg(label_id order by position)
    from public.user_label_order
    where user_id = '96000000-0000-0000-0000-000000000002'
      and workspace_id = '97000000-0000-0000-0000-000000000001'
  ),
  array['98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000001']::uuid[],
  'member personal order is preserved'
);

set local role postgres;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(
  (
    select array_agg(label_id order by position)
    from public.user_label_order
    where user_id = '96000000-0000-0000-0000-000000000003'
      and workspace_id = '97000000-0000-0000-0000-000000000001'
  ),
  array['98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002']::uuid[],
  'other member personal order is independent'
);

-- Nesting a top-level label clears personal order rows for that label.
set local role postgres;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
update public.labels
set parent_id = '98000000-0000-0000-0000-000000000001',
    inherit_permissions = true
where id = '98000000-0000-0000-0000-000000000002';

select is(
  (
    select count(*)::integer
    from public.user_label_order
    where label_id = '98000000-0000-0000-0000-000000000002'
  ),
  0,
  'nesting clears personal order for the moved label'
);

-- RLS: member cannot read another user's order rows.
set local role postgres;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.user_label_order
    where user_id = '96000000-0000-0000-0000-000000000003'
  ),
  0,
  'user_label_order RLS hides other users rows'
);

select * from finish();
rollback;
