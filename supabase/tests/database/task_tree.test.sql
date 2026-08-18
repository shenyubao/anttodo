begin;

create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('19000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tree-owner@example.com','',now(),'{}','{}',now(),now()),
  ('19000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tree-member@example.com','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name,created_by) values
  ('29000000-0000-0000-0000-000000000001','Tree One','19000000-0000-0000-0000-000000000001'),
  ('29000000-0000-0000-0000-000000000002','Tree Two','19000000-0000-0000-0000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role)
values ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002','member');

select has_column('public','tasks','parent_task_id','tasks expose a parent task id');
select has_column('public','tasks','position','tasks expose sibling position');
select hasnt_table('public','sub' || 'tasks','the legacy child table is absent');
select col_is_null('public','tasks','parent_task_id','root parent is nullable');
select col_not_null('public','tasks','position','sibling position is required');

insert into public.tasks(id,workspace_id,parent_task_id,position,title,created_by) values
  ('49000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001',null,0,'L1','19000000-0000-0000-0000-000000000001'),
  ('49000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000001',0,'L2','19000000-0000-0000-0000-000000000001'),
  ('49000000-0000-0000-0000-000000000003','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000002',0,'L3','19000000-0000-0000-0000-000000000001'),
  ('49000000-0000-0000-0000-000000000004','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000003',0,'L4','19000000-0000-0000-0000-000000000001'),
  ('49000000-0000-0000-0000-000000000005','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000004',0,'L5','19000000-0000-0000-0000-000000000001');

select is((select count(*)::integer from public.tasks where id::text like '49000000-%'),5,'five levels are accepted');
select throws_ok(
  $$insert into public.tasks(id,workspace_id,parent_task_id,title,created_by) values
    ('49000000-0000-0000-0000-000000000006','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000005','L6','19000000-0000-0000-0000-000000000001')$$,
  'P0001','Task tree cannot exceed five levels','a sixth level is rejected');
select throws_ok(
  $$update public.tasks set parent_task_id='49000000-0000-0000-0000-000000000005' where id='49000000-0000-0000-0000-000000000001'$$,
  'P0001','Task tree cycle detected','cycles are rejected');
select throws_ok(
  $$update public.tasks set parent_task_id=id where id='49000000-0000-0000-0000-000000000001'$$,
  'P0001','A task cannot be its own parent','self parenting is rejected');
select throws_ok(
  $$insert into public.tasks(id,workspace_id,parent_task_id,title,created_by) values
    ('49000000-0000-0000-0000-000000000007','29000000-0000-0000-0000-000000000002','49000000-0000-0000-0000-000000000001','Cross workspace','19000000-0000-0000-0000-000000000001')$$,
  'P0001','Parent task must be in the same workspace','cross workspace parenting is rejected');

insert into public.tasks(id,workspace_id,title,kind,created_by)
values ('49000000-0000-0000-0000-000000000010','29000000-0000-0000-0000-000000000001','Note','note','19000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.tasks(id,workspace_id,parent_task_id,title,created_by) values
    ('49000000-0000-0000-0000-000000000011','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000010','Below note','19000000-0000-0000-0000-000000000001')$$,
  'P0001','Notes cannot contain child tasks','notes cannot own descendants');

insert into public.labels(id,workspace_id,name,kind,view_scope,manage_scope,inherit_permissions,created_by)
values
  ('39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','Tree label','team','all','users',false,'19000000-0000-0000-0000-000000000001'),
  ('39000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000001','Private label','private','users','users',false,'19000000-0000-0000-0000-000000000001');
insert into public.task_labels(task_id,label_id)
values ('49000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.task_labels(task_id,label_id) values
    ('49000000-0000-0000-0000-000000000002','39000000-0000-0000-0000-000000000001')$$,
  'P0001','Labels can only be assigned to root tasks','descendants cannot own labels');
select is(anttodo_private.task_root_id('49000000-0000-0000-0000-000000000005'),
  '49000000-0000-0000-0000-000000000001'::uuid,'the root resolver follows the full chain');

insert into public.task_comments(workspace_id,task_id,author_id,body)
values ('29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000005','19000000-0000-0000-0000-000000000001','Exact task comment');
select is((select task_id from public.task_comments where body='Exact task comment'),
  '49000000-0000-0000-0000-000000000005'::uuid,'comments use one exact task id');
insert into public.focus_sessions(user_id,workspace_id,task_id,mode,kind,planned_seconds,elapsed_seconds,started_at,ended_at)
values ('19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000005','pomodoro','focus',60,60,now()-interval '1 minute',now());
select is((select task_id from public.focus_sessions where planned_seconds=60),
  '49000000-0000-0000-0000-000000000005'::uuid,'focus sessions use one exact task id');

insert into public.task_dependencies(workspace_id,task_id,depends_on_task_id,created_by)
values ('29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000005','49000000-0000-0000-0000-000000000010','19000000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.task_dependencies where task_id='49000000-0000-0000-0000-000000000005'),1,'dependencies accept any task level');
select throws_ok(
  $$insert into public.task_dependencies(workspace_id,task_id,depends_on_task_id) values
    ('29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000010','49000000-0000-0000-0000-000000000005')$$,
  '23514','Task dependency cycle detected','dependency cycles are rejected');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"19000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temp table nested_insert_returning on commit drop as
with inserted as (
  insert into public.tasks(
    id, workspace_id, parent_task_id, position, title, created_by
  ) values (
    '49000000-0000-0000-0000-000000000020',
    '29000000-0000-0000-0000-000000000001',
    '49000000-0000-0000-0000-000000000001',
    1,
    'Returning child',
    '19000000-0000-0000-0000-000000000001'
  )
  returning id
)
select id from inserted;
select is(
  (select id from nested_insert_returning),
  '49000000-0000-0000-0000-000000000020'::uuid,
  'INSERT RETURNING can see a newly created nested task'
);
select lives_ok(
  $$select public.move_task('49000000-0000-0000-0000-000000000002',null,1)$$,
  'a descendant can be promoted atomically');
select is((select parent_task_id from public.tasks where id='49000000-0000-0000-0000-000000000002'),null::uuid,'promotion clears the parent id');
select is((select count(*)::integer from public.task_labels where task_id='49000000-0000-0000-0000-000000000002'),1,'promotion copies root labels');
select lives_ok(
  $$select public.move_task('49000000-0000-0000-0000-000000000002','49000000-0000-0000-0000-000000000001',0)$$,
  'a root can be demoted atomically');
select is((select count(*)::integer from public.task_labels where task_id='49000000-0000-0000-0000-000000000002'),0,'demotion removes independent labels');
select lives_ok(
  $$select public.move_task(
    '49000000-0000-0000-0000-000000000005',
    '49000000-0000-0000-0000-000000000001',
    3
  )$$,
  'direct task moves use the unified move operation');
select is(
  (select parent_task_id from public.tasks where id='49000000-0000-0000-0000-000000000005'),
  '49000000-0000-0000-0000-000000000001'::uuid,
  'direct task moves retain one exact task id');
select lives_ok(
  $$update public.tasks set status='completed' where id='49000000-0000-0000-0000-000000000005'$$,
  'direct updates can complete an existing task');
select ok(
  (select completed_at is not null from public.tasks
    where id='49000000-0000-0000-0000-000000000005'),
  'direct completion updates populate completed_at');
select lives_ok(
  $$update public.tasks set status='open' where id='49000000-0000-0000-0000-000000000005'$$,
  'direct updates can reopen a completed task');
select is(
  (select completed_at from public.tasks
    where id='49000000-0000-0000-0000-000000000005'),
  null::timestamptz,
  'direct reopen clears completed_at');
select public.move_task(
  '49000000-0000-0000-0000-000000000005',
  '49000000-0000-0000-0000-000000000004',
  0
);

reset role;
update public.tasks set deleted_at=now() where id='49000000-0000-0000-0000-000000000003';
select is((select count(*)::integer from public.get_task_tree('49000000-0000-0000-0000-000000000005') where id in
  ('49000000-0000-0000-0000-000000000003','49000000-0000-0000-0000-000000000004','49000000-0000-0000-0000-000000000005')),0,'a deleted ancestor hides its active descendants');
update public.tasks set deleted_at=null where id='49000000-0000-0000-0000-000000000003';
select is((select count(*)::integer from public.get_task_tree('49000000-0000-0000-0000-000000000005') where id in
  ('49000000-0000-0000-0000-000000000003','49000000-0000-0000-0000-000000000004','49000000-0000-0000-0000-000000000005')),3,'restoring the ancestor reveals descendants');

select * from finish();
rollback;
