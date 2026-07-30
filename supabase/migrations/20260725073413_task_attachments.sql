insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'task-attachments',
  'task-attachments',
  false,
  20971520,
  array[
    'application/json',
    'application/msword',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/markdown',
    'text/plain'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function anttodo_private.attachment_workspace_id(object_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  folders text[] := storage.foldername(object_name);
begin
  if coalesce(array_length(folders, 1), 0) <> 2
    or folders[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return null;
  end if;
  return folders[1]::uuid;
end;
$$;

create or replace function anttodo_private.attachment_task_id(object_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  folders text[] := storage.foldername(object_name);
begin
  if coalesce(array_length(folders, 1), 0) <> 2
    or folders[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return null;
  end if;
  return folders[2]::uuid;
end;
$$;

revoke all on function anttodo_private.attachment_workspace_id(text)
from public, anon;
revoke all on function anttodo_private.attachment_task_id(text)
from public, anon;
grant execute on function anttodo_private.attachment_workspace_id(text)
to authenticated;
grant execute on function anttodo_private.attachment_task_id(text)
to authenticated;

create policy task_attachments_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.tasks task
    where task.id = (select anttodo_private.attachment_task_id(name))
      and task.workspace_id = (
        select anttodo_private.attachment_workspace_id(name)
      )
      and (select anttodo_private.can_view_task(task.id))
  )
);

create policy task_attachments_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(csv|doc|docx|gif|jpe?g|json|md|pdf|png|ppt|pptx|txt|webp|xls|xlsx|zip)$'
  and exists (
    select 1
    from public.tasks task
    where task.id = (select anttodo_private.attachment_task_id(name))
      and task.workspace_id = (
        select anttodo_private.attachment_workspace_id(name)
      )
      and (select anttodo_private.can_edit_task(task.id))
  )
);

create policy task_attachments_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.tasks task
    where task.id = (select anttodo_private.attachment_task_id(name))
      and task.workspace_id = (
        select anttodo_private.attachment_workspace_id(name)
      )
      and (select anttodo_private.can_edit_task(task.id))
  )
);
