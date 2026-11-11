begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('19100000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','drag-owner@example.com','',now(),'{}','{}',now(),now()),
('19100000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','drag-member@example.com','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name,created_by,updated_at) values
('29100000-0000-0000-0000-000000000001','Drag One','19100000-0000-0000-0000-000000000001','2026-01-01'),
('29100000-0000-0000-0000-000000000002','Drag Two','19100000-0000-0000-0000-000000000001','2026-01-01');
insert into public.workspace_members(workspace_id,user_id,role)
values('29100000-0000-0000-0000-000000000001','19100000-0000-0000-0000-000000000002','member');
insert into public.tasks(id,workspace_id,parent_task_id,position,title,created_by) values
('49100000-0000-0000-0000-000000000001','29100000-0000-0000-0000-000000000001',null,0,'Source','19100000-0000-0000-0000-000000000001'),
('49100000-0000-0000-0000-000000000002','29100000-0000-0000-0000-000000000001','49100000-0000-0000-0000-000000000001',0,'Child','19100000-0000-0000-0000-000000000001'),
('49100000-0000-0000-0000-000000000003','29100000-0000-0000-0000-000000000001','49100000-0000-0000-0000-000000000002',0,'Grandchild','19100000-0000-0000-0000-000000000001'),
('49100000-0000-0000-0000-000000000004','29100000-0000-0000-0000-000000000001',null,1,'Target','19100000-0000-0000-0000-000000000001'),
('49100000-0000-0000-0000-000000000005','29100000-0000-0000-0000-000000000002',null,7,'Other workspace','19100000-0000-0000-0000-000000000001');
insert into public.labels(id,workspace_id,name,kind,view_scope,manage_scope,inherit_permissions,created_by) values
('39100000-0000-0000-0000-000000000001','29100000-0000-0000-0000-000000000001','Source label','team','all','users',false,'19100000-0000-0000-0000-000000000001'),
('39100000-0000-0000-0000-000000000002','29100000-0000-0000-0000-000000000001','Target label','private','users','users',false,'19100000-0000-0000-0000-000000000001');
insert into public.task_labels(task_id,label_id) values
('49100000-0000-0000-0000-000000000001','39100000-0000-0000-0000-000000000001'),
('49100000-0000-0000-0000-000000000004','39100000-0000-0000-0000-000000000002');

select ok(not has_function_privilege('anon','public.move_task_in_list(uuid,uuid,integer,jsonb,bigint)','execute'),'anonymous callers cannot move tasks');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"19100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000002',null,1,null,-1)$$,
  '40001','Task changed; refresh and retry','stale moves are rejected');
select throws_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000002',null,1,
  '{"listKey":"all","sectionId":"59100000-0000-0000-0000-000000000099","taskIds":["49100000-0000-0000-0000-000000000002"]}')$$,
  '22023','Invalid task section','placement failure rejects the transaction');
select is((select parent_task_id from public.tasks where id='49100000-0000-0000-0000-000000000002'),
  '49100000-0000-0000-0000-000000000001'::uuid,'failed promotion restores the parent');
select is((select count(*)::integer from public.task_labels where task_id='49100000-0000-0000-0000-000000000002'),0,'failed promotion restores independent labels');
select is((select position from public.tasks where id='49100000-0000-0000-0000-000000000004'),1,'failed promotion restores sibling order');
select is((select updated_at from public.workspaces where id='29100000-0000-0000-0000-000000000001'),
  '2026-01-01'::timestamptz,'failed move rolls back the Realtime invalidation signal');
select lives_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000002',null,1,
  '{"listKey":"all","sectionId":null,"taskIds":["49100000-0000-0000-0000-000000000001","49100000-0000-0000-0000-000000000002","49100000-0000-0000-0000-000000000004"]}')$$,
  'promotion and list placement commit together');
select ok((select updated_at>'2026-01-01'::timestamptz from public.workspaces where id='29100000-0000-0000-0000-000000000001'),
  'a workspace signal refreshes clients even when moved rows lose visibility');
select is((select updated_at from public.workspaces where id='29100000-0000-0000-0000-000000000002'),
  '2026-01-01'::timestamptz,'the signal leaves other workspaces untouched');
select is((select position from public.task_list_placements where task_id='49100000-0000-0000-0000-000000000002' and list_key='all'),1,'promotion saves the exact list slot');
select is((select position from public.tasks where id='49100000-0000-0000-0000-000000000005'),7,'other workspace root positions remain unchanged');
select is((select count(*)::integer from public.task_labels where task_id='49100000-0000-0000-0000-000000000002'),1,'promotion keeps inherited labels');
insert into public.task_participants(task_id,user_id,created_by) values
('49100000-0000-0000-0000-000000000003','19100000-0000-0000-0000-000000000002','19100000-0000-0000-0000-000000000001');
select throws_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000002','49100000-0000-0000-0000-000000000004',0)$$,
  'P0001','Move would remove task visibility','descendant participants cannot lose access silently');
select is((select parent_task_id from public.tasks where id='49100000-0000-0000-0000-000000000002'),null::uuid,'visibility failure preserves the root');
delete from public.task_participants where task_id='49100000-0000-0000-0000-000000000003';
select lives_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000002','49100000-0000-0000-0000-000000000004',0)$$,'the whole subtree can change root');
select is((select parent_task_id from public.tasks where id='49100000-0000-0000-0000-000000000003'),
  '49100000-0000-0000-0000-000000000002'::uuid,'descendants retain their exact relationship');
select is((select count(*)::integer from public.task_list_placements where task_id='49100000-0000-0000-0000-000000000002'),0,'demotion removes obsolete root placements');
select throws_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000004','49100000-0000-0000-0000-000000000003',0)$$,
  'P0001','Task tree cycle detected','descendant destinations are rejected by the server');
select throws_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000002','49100000-0000-0000-0000-000000000005',0)$$,
  'P0001','Parent task must be in the same workspace','cross-workspace destinations are rejected');
select set_config('request.jwt.claims','{"sub":"19100000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.move_task_in_list('49100000-0000-0000-0000-000000000001',null,0)$$,
  '42501','Task is not editable','view permission does not allow moving');
select is((select count(*)::integer from public.tasks where id='49100000-0000-0000-0000-000000000002'),0,'private destination hides its entire subtree from other members');
select * from finish();
rollback;
