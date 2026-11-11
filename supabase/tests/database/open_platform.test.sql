begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('e1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','open-api-test@example.invalid','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name,created_by) values
 ('e2000000-0000-4000-8000-000000000001','Open API One','e1000000-0000-4000-8000-000000000001'),
 ('e2000000-0000-4000-8000-000000000002','Open API Two','e1000000-0000-4000-8000-000000000001');
insert into anttodo_private.open_apps(client_id,name,client_type) values('e3000000-0000-4000-8000-000000000001','Fixture','public');
insert into anttodo_private.open_grants(id,user_id,client_id,oauth_client_id,name,workspace_ids,permissions,pending_until) values
 ('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Fixture',array['e2000000-0000-4000-8000-000000000001']::uuid[],array['tasks:read','tasks:write','tasks:delete'],now()+interval '10 minutes');
insert into auth.sessions(id,user_id,created_at,updated_at) values('e5000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',now(),now());
create temporary table hook as select anttodo_private.cli_access_token_hook(jsonb_build_object('claims',jsonb_build_object('sub','e1000000-0000-4000-8000-000000000001','role','authenticated','client_id','e3000000-0000-4000-8000-000000000001','session_id','e5000000-0000-4000-8000-000000000001','iat',extract(epoch from now())::bigint,'exp',extract(epoch from now()+interval '1 hour')::bigint))) value;
select is((select value#>>'{claims,role}' from hook),'anttodo_openapi','OAuth uses the isolated database role');
select is((select value#>>'{claims,open_grant_id}' from hook),'e4000000-0000-4000-8000-000000000001','OAuth session binds to an immutable business grant');
select is((select (value#>>'{claims,exp}')::bigint-(value#>>'{claims,iat}')::bigint from hook),900::bigint,'OAuth JWT lasts at most 15 minutes');
select is(jsonb_array_length(public.open_platform_admin('list','e1000000-0000-4000-8000-000000000001','{}')->'grants'),1,'management lists grants without SQL variable ambiguity');
select ok(not (public.open_platform_admin('list','e1000000-0000-4000-8000-000000000001','{}')::text like '%secret_hash%'),'management never returns credential hashes');
select set_config('request.jwt.claims',(select (value->'claims')::text from hook),true);

select ok(not has_table_privilege('anttodo_openapi','public.tasks','SELECT'),'raw token cannot read the tasks table');
select ok(not has_table_privilege('anttodo_openapi','public.tasks','UPDATE'),'raw token cannot update tasks directly');
select ok(not has_table_privilege('anttodo_openapi','storage.objects','SELECT'),'raw token cannot read Storage objects');
select ok(not has_function_privilege('anttodo_openapi','public.create_task_with_labels(uuid,text,uuid[],text,timestamp with time zone,public.task_priority,uuid,text,public.task_kind)','EXECUTE'),'existing RPC cannot bypass scopes');
select ok(not has_function_privilege('anttodo_openapi','public.create_task_comment(uuid,text,text[],uuid[])','EXECUTE'),'comment API is outside v1');
select ok(not has_function_privilege('anttodo_openapi','public.open_platform_admin(text,uuid,jsonb)','EXECUTE'),'third-party tokens cannot manage grants');
select ok(not has_function_privilege('authenticated','public.open_platform_admin(text,uuid,jsonb)','EXECUTE'),'management RPC requires the service boundary');
select ok(not (select rolbypassrls from pg_roles where rolname='anttodo_openapi_executor'),'dispatcher executor never bypasses RLS');
select is(jsonb_array_length(public.open_api_dispatch('GET','/workspaces')->'data'),1,'workspace discovery is restricted to the selected grant');
select throws_ok($$select public.open_api_dispatch('GET','/workspaces/e2000000-0000-4000-8000-000000000002/tasks')$$,'42501','workspace_not_authorized','user membership alone does not authorize another workspace');

create temporary table created as select public.open_api_dispatch('POST','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{}','{"title":"Fixture task","list_id":"inbox"}',null,'fixture-create') value;
select is((select value#>>'{data,title}' from created),'Fixture task','creates a real task through existing RLS');
select is(public.open_api_dispatch('POST','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{}','{"title":"Fixture task","list_id":"inbox"}',null,'fixture-create'),(select value from created),'lost-response retry returns the original created task');
select throws_ok($$select public.open_api_dispatch('POST','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{}','{"title":"Different"}',null,'fixture-create')$$,'P0409','idempotency_key_reused','same key cannot mutate a different payload');
select is(jsonb_array_length(public.open_api_dispatch('GET','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{"list_id":"inbox"}')->'data'->'items'),1,'unlabelled task appears in inbox');
select throws_ok(format('select public.open_api_dispatch(''PATCH'',%L,''{}'',''{"title":"Missing version"}'')','/tasks/'||(select value#>>'{data,id}' from created)),'P0428','if_match_required','database boundary also enforces versions');
select throws_ok(format('select public.open_api_dispatch(''PATCH'',%L,''{}'',''{"title":"Stale"}'',999)','/tasks/'||(select value#>>'{data,id}' from created)),'P0412','version_conflict','stale updates cannot overwrite tasks');
create temporary table edited as select public.open_api_dispatch('PATCH','/tasks/'||(value#>>'{data,id}'),'{}','{"title":"Changed"}',(value#>>'{data,version}')::bigint) value from created;
select is((select value#>>'{data,task,title}' from edited),'Changed','matching version updates the task');

update anttodo_private.open_grants set permissions=array['tasks:read'] where id='e4000000-0000-4000-8000-000000000001';
select throws_ok($$select public.open_api_dispatch('POST','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{}','{"title":"Forbidden"}')$$,'42501','insufficient_scope','read-only authorization blocks create');
select is((public.open_api_dispatch('GET','/tasks/'||(select value#>>'{data,id}' from created))#>>'{data,capabilities,edit}')::boolean,false,'read-only capabilities match enforcement');
update anttodo_private.open_grants set permissions=array['tasks:read','tasks:write'] where id='e4000000-0000-4000-8000-000000000001';
select throws_ok(format('select public.open_api_dispatch(''DELETE'',%L,''{}'',''{}'',1)','/tasks/'||(select value#>>'{data,id}' from created)),'42501','insufficient_scope','write permission does not imply delete');
update anttodo_private.open_grants set permissions=array['tasks:read','tasks:write','tasks:delete'] where id='e4000000-0000-4000-8000-000000000001';

insert into public.labels(id,workspace_id,name,created_by) values
 ('e6000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','A','e1000000-0000-4000-8000-000000000001'),
 ('e6000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','B','e1000000-0000-4000-8000-000000000001'),
 ('e6000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001','Keep','e1000000-0000-4000-8000-000000000001');
insert into public.task_labels(task_id,label_id) select (value#>>'{data,id}')::uuid,unnest(array['e6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000003']::uuid[]) from created;
create temporary table moved as select public.open_api_dispatch('POST','/tasks/'||t.id||'/move','{}','{"source_list_id":"label:e6000000-0000-4000-8000-000000000001","target_list_id":"label:e6000000-0000-4000-8000-000000000002"}',t.version) value from public.tasks t where t.id=(select (value#>>'{data,id}')::uuid from created);
select ok((select value#>'{data,task,label_ids}' from moved) ? 'e6000000-0000-4000-8000-000000000003','label move preserves unrelated labels');
select ok(not (select value#>'{data,task,label_ids}' from moved) ? 'e6000000-0000-4000-8000-000000000001','label move removes only the source');
select ok((select value#>'{data,task,label_ids}' from moved) ? 'e6000000-0000-4000-8000-000000000002','label move adds the destination');

create temporary table removed as select public.open_api_dispatch('DELETE','/tasks/'||(value#>>'{data,task,id}'),'{}','{}',(value#>>'{data,task,version}')::bigint) value from moved;
select ok((select value#>>'{data,task,deleted_at}' from removed) is not null,'delete moves the task into the recoverable trash');
create temporary table restored as select public.open_api_dispatch('POST','/tasks/'||(value#>>'{data,task,id}')||'/restore','{}','{}',(value#>>'{data,task,version}')::bigint) value from removed;
select ok((select value#>>'{data,task,deleted_at}' from restored) is null,'restore returns a task from trash');

select is(jsonb_array_length(public.open_api_dispatch('GET','/workspaces/e2000000-0000-4000-8000-000000000001/lists')->'data'),10,'system views and labels share one list contract');
select is(jsonb_array_length(public.open_api_dispatch('GET','/workspaces/e2000000-0000-4000-8000-000000000001/labels')->'data'),3,'label metadata respects workspace selection');
create temporary table child as select public.open_api_dispatch('POST','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{}',jsonb_build_object('title','Child','parent_task_id',value#>>'{data,task,id}','list_id','all')) value from restored;
select is((select value#>>'{data,parent_task_id}' from child),(select value#>>'{data,task,id}' from restored),'subtask creation preserves the selected parent');
select ok((select value#>'{data,label_ids}' from child) ? 'e6000000-0000-4000-8000-000000000003','subtasks expose inherited root labels');
create temporary table duplicate as select public.open_api_dispatch('POST','/tasks/'||(value#>>'{data,task,id}')||'/duplicate','{}','{}',(value#>>'{data,task,version}')::bigint) value from restored;
select is((select count(*)::integer from public.tasks where parent_task_id=(select (value#>>'{data,task,id}')::uuid from duplicate)),1,'duplication copies the subtree with fresh identities');
select isnt((select value#>>'{data,task,id}' from duplicate),(select value#>>'{data,task,id}' from restored),'duplicate is a new task');
create temporary table scheduled as select public.open_api_dispatch('PATCH','/tasks/'||t.id,'{}','{"due_at":"2026-11-04T16:00:00Z","due_start_at":"2026-11-04T16:00:00Z","due_is_all_day":true,"due_timezone":"Asia/Shanghai"}',t.version) value from public.tasks t where t.id=(select (value#>>'{data,task,id}')::uuid from duplicate);
select is((select value#>>'{data,task,due_timezone}' from scheduled),'Asia/Shanghai','dates preserve their IANA timezone');
select is((select (value#>>'{data,task,due_is_all_day}')::boolean from scheduled),true,'all-day schedule flag survives the API');
select is(jsonb_array_length(public.open_api_dispatch('GET','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{"limit":"1"}')->'data'->'items'),1,'pagination limits task rows');
select ok(public.open_api_dispatch('GET','/workspaces/e2000000-0000-4000-8000-000000000001/tasks','{"limit":"1"}')#>>'{data,next_cursor}' is not null,'pagination supplies a continuation cursor');
update anttodo_private.open_grants set revoked_at=now() where id='e4000000-0000-4000-8000-000000000001';
select throws_ok($$select public.open_api_dispatch('GET','/me')$$,'28000','invalid_token','revocation immediately rejects an already-issued JWT');
select * from finish();
rollback;
