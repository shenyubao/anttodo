-- Remote storage.objects had RLS enabled with zero policies, which blocked all
-- authenticated uploads (task attachments, comment images, profile avatars).
-- Recreate the policies defined by earlier migrations if they are missing.

drop policy if exists task_attachments_select on storage.objects;
drop policy if exists task_attachments_insert on storage.objects;
drop policy if exists task_attachments_delete on storage.objects;
drop policy if exists comment_images_select on storage.objects;
drop policy if exists comment_images_insert on storage.objects;
drop policy if exists comment_images_delete on storage.objects;
drop policy if exists profile_avatars_insert_self on storage.objects;
drop policy if exists profile_avatars_update_self on storage.objects;
drop policy if exists profile_avatars_delete_self on storage.objects;

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

create policy comment_images_select
on storage.objects for select to authenticated
using (
  bucket_id = 'comment-images'
  and exists (
    select 1 from public.tasks task
    where task.id = (select anttodo_private.comment_image_folder_id(name, 2))
      and task.workspace_id = (select anttodo_private.comment_image_folder_id(name, 1))
      and (select anttodo_private.can_view_task(task.id))
  )
);

create policy comment_images_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'comment-images'
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(gif|jpe?g|png|webp)$'
  and (select anttodo_private.comment_image_folder_id(name, 3)) = (select auth.uid())
  and exists (
    select 1 from public.tasks task
    where task.id = (select anttodo_private.comment_image_folder_id(name, 2))
      and task.workspace_id = (select anttodo_private.comment_image_folder_id(name, 1))
      and (select anttodo_private.can_view_task(task.id))
  )
);

create policy comment_images_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'comment-images'
  and owner_id = (select auth.uid())::text
  and (select anttodo_private.comment_image_folder_id(name, 3)) = (select auth.uid())
  and exists (
    select 1 from public.tasks task
    where task.id = (select anttodo_private.comment_image_folder_id(name, 2))
      and (select anttodo_private.can_view_task(task.id))
  )
);

create policy profile_avatars_insert_self
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
);

create policy profile_avatars_update_self
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
);

create policy profile_avatars_delete_self
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
