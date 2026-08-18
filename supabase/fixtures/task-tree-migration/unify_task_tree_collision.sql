\set ON_ERROR_STOP on

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values ('1b000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','collision-owner@example.com','',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name,created_by)
values ('2b000000-0000-0000-0000-000000000001','Collision Fixture','1b000000-0000-0000-0000-000000000001');
insert into public.tasks(id,workspace_id,title,created_by) values
  ('4b000000-0000-0000-0000-000000000001','2b000000-0000-0000-0000-000000000001','Root','1b000000-0000-0000-0000-000000000001'),
  ('5b000000-0000-0000-0000-000000000001','2b000000-0000-0000-0000-000000000001','Conflicting task','1b000000-0000-0000-0000-000000000001');
insert into public.subtasks(id,task_id,title,created_by)
values ('5b000000-0000-0000-0000-000000000001','4b000000-0000-0000-0000-000000000001','Conflicting row','1b000000-0000-0000-0000-000000000001');

