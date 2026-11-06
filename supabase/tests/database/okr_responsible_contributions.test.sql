begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a9100000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'okr-contributor-' || i || '@example.test', '', now(), '{}', '{}', now(), now()
from generate_series(1,4) i;
insert into public.workspaces(id,name,created_by) values
  ('b9100000-0000-0000-0000-000000000001','KR contribution','a9100000-0000-0000-0000-000000000001'),
  ('b9100000-0000-0000-0000-000000000002','Other contribution workspace','a9100000-0000-0000-0000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role) values
  ('b9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000002','member'),
  ('b9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000003','admin');
insert into public.okr_cycles(id,workspace_id,name,starts_on,ends_on,status,created_by) values
  ('c9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','Active',current_date-1,current_date+30,'active','a9100000-0000-0000-0000-000000000001');
insert into public.okr_sets(id,workspace_id,cycle_id,owner_id,published_at,published_version) values
  ('d9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','c9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000001',now(),1);
insert into public.okr_objectives(id,workspace_id,set_id,title,published_at) values
  ('e9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000001','Shared Objective',now());
insert into public.okr_key_results(id,workspace_id,objective_id,title,current_value,published_at,weight) values
  ('f9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000001','Assigned KR',10,now(),50),
  ('f9100000-0000-0000-0000-000000000002','b9100000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000001','Unassigned KR',0,now(),50);
insert into public.okr_key_result_responsibles(key_result_id,workspace_id,user_id) values
  ('f9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000002');
insert into public.tasks(id,workspace_id,title,created_by) values
  ('09100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','Contributor todo','a9100000-0000-0000-0000-000000000002'),
  ('09100000-0000-0000-0000-000000000002','b9100000-0000-0000-0000-000000000001','Owner private inbox todo','a9100000-0000-0000-0000-000000000001'),
  ('09100000-0000-0000-0000-000000000003','b9100000-0000-0000-0000-000000000002','Other workspace todo','a9100000-0000-0000-0000-000000000002');

select ok(not has_function_privilege('anon','anttodo_private.can_contribute_okr_key_result(uuid)','execute'),'anonymous callers cannot execute contribution helper');
select ok(not has_function_privilege('authenticated','anttodo_private.guard_okr_contributor_update()','execute'),'column guard is not a callable client API');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9100000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(anttodo_private.can_contribute_okr_key_result('f9100000-0000-0000-0000-000000000001'),'assigned KR responsible can contribute');
select ok(not anttodo_private.owns_okr_key_result('f9100000-0000-0000-0000-000000000001'),'responsibility does not grant structural ownership');
select lives_ok($$select public.update_okr_key_result_progress('f9100000-0000-0000-0000-000000000001',45,'normal','Contributor progress')$$,'responsible can submit progress through invoker RPC and RLS');
select is((select current_value from public.okr_key_results where id='f9100000-0000-0000-0000-000000000001'),45::numeric,'progress value is saved');
select is((select previous_value from public.okr_progress_records where key_result_id='f9100000-0000-0000-0000-000000000001'),10::numeric,'progress record preserves previous value');
select is((select actor_id from public.okr_progress_records where key_result_id='f9100000-0000-0000-0000-000000000001'),'a9100000-0000-0000-0000-000000000002'::uuid,'progress records identify the actual contributor');
select throws_ok('update public.okr_key_results set ' || assignment || ' where id=''f9100000-0000-0000-0000-000000000001''','42501',null,'responsible cannot change ' || field)
from (values ('title','title=''Changed'''),('weight','weight=75'),('visibility','visibility=''workspace'''),('note','note=''Changed'''),('target','target_value=200'),('score','score=0.8'),('publication','published_at=null'),('identity','id=''f9100000-0000-0000-0000-000000000003''')) fields(field,assignment);
select lives_ok($$delete from public.okr_key_results where id='f9100000-0000-0000-0000-000000000001'$$,'delete with no owned row changes nothing');
select is((select count(*)::integer from public.okr_key_results where id='f9100000-0000-0000-0000-000000000001'),1,'responsible cannot delete KR');
select throws_ok($$insert into public.okr_key_result_responsibles(key_result_id,workspace_id,user_id) values ('f9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000003')$$,'42501',null,'responsible cannot grant responsibility to others');
select throws_ok($$select public.save_okr_changes('d9100000-0000-0000-0000-000000000001','{"objectives":[]}'::jsonb,false)$$,'42501',null,'responsible cannot use structural save RPC');
select throws_ok($$insert into public.okr_progress_records(key_result_id,workspace_id,actor_id,current_status) values ('f9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000001','normal')$$,'42501',null,'responsible cannot forge another progress actor');
select lives_ok($$select public.set_task_okr_link('09100000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000001')$$,'responsible can link an authorized task to assigned KR');
select is((select count(*)::integer from public.task_okr_links),1,'new association is visible through existing RLS');
select throws_ok($$select public.set_task_okr_link('09100000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000002')$$,'42501',null,'responsible cannot link unassigned KR');
select throws_ok($$select public.update_okr_key_result_progress('f9100000-0000-0000-0000-000000000002',60,'normal','Unauthorized')$$,'42501',null,'responsible cannot update another KR');
select throws_ok($$select public.set_task_okr_link('09100000-0000-0000-0000-000000000002','f9100000-0000-0000-0000-000000000001')$$,'42501',null,'KR responsibility does not bypass task permission');
select throws_ok($$select public.set_task_okr_link('09100000-0000-0000-0000-000000000003','f9100000-0000-0000-0000-000000000001')$$,'22023',null,'cross-workspace linking remains forbidden');

select set_config('request.jwt.claims','{"sub":"a9100000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select ok(not anttodo_private.can_contribute_okr_key_result('f9100000-0000-0000-0000-000000000001'),'unassigned viewer/admin cannot contribute');
select throws_ok($$select public.update_okr_key_result_progress('f9100000-0000-0000-0000-000000000001',60,'normal','Unauthorized')$$,'42501',null,'unassigned viewer cannot submit progress');

reset role;
delete from public.okr_key_result_responsibles where key_result_id='f9100000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9100000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(not anttodo_private.can_contribute_okr_key_result('f9100000-0000-0000-0000-000000000001'),'revoking responsibility immediately removes contribution rights');
select throws_ok($$select public.update_okr_key_result_progress('f9100000-0000-0000-0000-000000000001',60,'normal','Revoked')$$,'42501',null,'revoked responsible cannot submit progress');
select lives_ok($$update public.okr_key_results set current_value=99 where id='f9100000-0000-0000-0000-000000000001'$$,'direct updates to revoked rows affect zero rows');
select is((select current_value from public.okr_key_results where id='f9100000-0000-0000-0000-000000000001'),45::numeric,'revoked direct update cannot change value');

reset role;
insert into public.okr_key_result_responsibles(key_result_id,workspace_id,user_id) values ('f9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000002');
update public.okr_cycles set status='closed' where id='c9100000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(not anttodo_private.can_contribute_okr_key_result('f9100000-0000-0000-0000-000000000001'),'closed cycle remains read-only for responsible');
select throws_ok($$select public.update_okr_key_result_progress('f9100000-0000-0000-0000-000000000001',60,'normal','Closed')$$,'42501',null,'closed cycle rejects progress');
select throws_ok($$select public.set_task_okr_link('09100000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000001')$$,'42501',null,'closed cycle rejects associations');
reset role;
update public.okr_cycles set status='draft' where id='c9100000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(not anttodo_private.can_contribute_okr_key_result('f9100000-0000-0000-0000-000000000001'),'draft cycle remains read-only for responsible');
reset role;
update public.okr_cycles set status='active' where id='c9100000-0000-0000-0000-000000000001';
update public.okr_key_results set visibility='restricted' where id='f9100000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(not anttodo_private.can_contribute_okr_key_result('f9100000-0000-0000-0000-000000000001'),'responsibility does not bypass visibility restrictions');
select throws_ok($$select public.update_okr_key_result_progress('f9100000-0000-0000-0000-000000000001',60,'normal','Hidden')$$,'42501',null,'hidden KR rejects progress');

select set_config('request.jwt.claims','{"sub":"a9100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$update public.okr_key_results set title='Owner edit',weight=40 where id='f9100000-0000-0000-0000-000000000001'$$,'owner retains structural editing rights');
select lives_ok($$select public.update_okr_key_result_progress('f9100000-0000-0000-0000-000000000001',70,'normal','Owner progress')$$,'owner retains progress rights');
select lives_ok($$select public.set_task_okr_link('09100000-0000-0000-0000-000000000002','f9100000-0000-0000-0000-000000000001')$$,'owner retains linking rights');
select * from finish();
rollback;
