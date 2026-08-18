\set ON_ERROR_STOP on

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '1a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','migration-owner@example.com','',now(),'{}','{}',now(),now()
);
insert into public.workspaces(id,name,created_by)
values ('2a000000-0000-0000-0000-000000000001','Migration Fixture','1a000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims','{"sub":"1a000000-0000-0000-0000-000000000001","role":"authenticated"}',false);

insert into public.tasks(
  id,workspace_id,title,description,status,priority,due_at,estimate_hours,actual_hours,
  estimate_pomodoros,actual_pomodoros,created_by,version,created_at,updated_at
) values (
  '4a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-000000000001',
  'Migration root','Root description','open','high','2026-08-20T10:00:00Z',3.5,1.5,8,3,
  '1a000000-0000-0000-0000-000000000001',9,'2026-08-01T00:00:00Z','2026-08-14T00:00:00Z'
);
insert into public.subtasks(
  id,task_id,parent_subtask_id,title,description,completed,position,priority,
  due_at,due_start_at,due_is_all_day,due_timezone,estimate_hours,actual_hours,
  estimate_pomodoros,actual_pomodoros,created_by,version,created_at,updated_at
) values
  ('5a000000-0000-0000-0000-000000000001','4a000000-0000-0000-0000-000000000001',null,
   'Migration L2','Second level',false,2,'medium','2026-08-18T10:00:00Z',null,false,'Asia/Shanghai',
   2.0,0.5,4,1,'1a000000-0000-0000-0000-000000000001',11,'2026-08-02T00:00:00Z','2026-08-13T00:00:00Z'),
  ('5a000000-0000-0000-0000-000000000002','4a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001',
   'Migration L3','Third level anttodo-storage://task-attachments/2a000000-0000-0000-0000-000000000001/4a000000-0000-0000-0000-000000000001/legacy.txt',true,1,'low','2026-08-17T10:00:00Z',null,false,'UTC',
   1.0,1.0,2,2,'1a000000-0000-0000-0000-000000000001',12,'2026-08-03T00:00:00Z','2026-08-12T00:00:00Z');

insert into public.task_comments(workspace_id,task_id,subtask_id,author_id,body,image_uris)
values ('2a000000-0000-0000-0000-000000000001','4a000000-0000-0000-0000-000000000001',
  '5a000000-0000-0000-0000-000000000002','1a000000-0000-0000-0000-000000000001',
  'Nested comment',array[]::text[]);
insert into public.focus_sessions(
  user_id,workspace_id,task_id,subtask_id,mode,kind,planned_seconds,elapsed_seconds,started_at,ended_at
) values ('1a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-000000000001',
  '4a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002',
  'pomodoro','focus',1500,1500,'2026-08-10T00:00:00Z','2026-08-10T00:25:00Z');
insert into public.task_reminders(
  task_id,subtask_id,anchor,offset_value,offset_unit,trigger_at,position,created_by
) values ('4a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002',
  'end',30,'minute','2026-08-17T09:30:00Z',0,'1a000000-0000-0000-0000-000000000001');
insert into public.subtask_reminder_settings(subtask_id,persistent,updated_by)
values ('5a000000-0000-0000-0000-000000000002',true,'1a000000-0000-0000-0000-000000000001');
insert into public.task_dependencies(
  workspace_id,task_id,subtask_id,depends_on_task_id,depends_on_subtask_id,position,created_by
) values ('2a000000-0000-0000-0000-000000000001','4a000000-0000-0000-0000-000000000001',
  '5a000000-0000-0000-0000-000000000002','4a000000-0000-0000-0000-000000000001',
  '5a000000-0000-0000-0000-000000000001',0,'1a000000-0000-0000-0000-000000000001');
insert into public.activity_events(workspace_id,task_id,actor_id,event_type,payload,created_at)
values ('2a000000-0000-0000-0000-000000000001','4a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001','task.subtask_updated',
  '{"subtask_id":"5a000000-0000-0000-0000-000000000002","changes":{"completed":{"after":true}}}',
  '2026-08-12T00:00:00Z');
