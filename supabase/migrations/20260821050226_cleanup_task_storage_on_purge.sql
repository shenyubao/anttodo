-- Queue task-owned Storage objects before a hard delete removes the rows that
-- authorize and reference them. Moving a task to the trash is only an UPDATE,
-- so its files remain available for restore.
create or replace function anttodo_private.enqueue_deleted_task_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment record;
  requester uuid := coalesce((select auth.uid()), old.created_by);
begin
  for attachment in
    select distinct candidate.bucket, candidate.object_path, candidate.canonical_uri
    from (
      select
        'task-attachments'::text as bucket,
        matched[1] as object_path,
        'anttodo-storage://task-attachments/' || matched[1] as canonical_uri
      from regexp_matches(
        old.description,
        'anttodo-storage://task-attachments/([^[:space:]<>\)]+)',
        'g'
      ) matched

      union all

      select
        'comment-images'::text,
        regexp_replace(image_uri, '^anttodo-storage://comment-images/', ''),
        image_uri
      from public.task_comments comment
      cross join lateral unnest(comment.image_uris) image_uri
      where comment.task_id = old.id
        and image_uri like 'anttodo-storage://comment-images/%'

      union all

      select
        stored.bucket_id,
        stored.name,
        'anttodo-storage://' || stored.bucket_id || '/' || stored.name
      from storage.objects stored
      where stored.bucket_id in ('task-attachments', 'comment-images')
        and stored.name like old.workspace_id::text || '/' || old.id::text || '/%'

      union all

      select
        binding.bucket_id,
        binding.object_name,
        'anttodo-storage://' || binding.bucket_id || '/' || binding.object_name
      from anttodo_private.task_attachment_bindings binding
      where binding.task_id = old.id
        and binding.bucket_id in ('task-attachments', 'comment-images')
    ) candidate
    where candidate.object_path like old.workspace_id::text || '/%'
  loop
    insert into public.attachment_cleanup_queue(
      workspace_id,
      bucket,
      object_path,
      canonical_uri,
      requested_by
    ) values (
      old.workspace_id,
      attachment.bucket,
      attachment.object_path,
      attachment.canonical_uri,
      requester
    )
    on conflict (bucket, object_path) do update
    set workspace_id = excluded.workspace_id,
        canonical_uri = excluded.canonical_uri,
        requested_by = excluded.requested_by,
        attempts = 0,
        available_at = now(),
        processed_at = null,
        last_error = null;
  end loop;

  return old;
end;
$$;

revoke all on function anttodo_private.enqueue_deleted_task_attachments()
from public, anon, authenticated;

drop trigger if exists tasks_enqueue_deleted_attachments on public.tasks;
create trigger tasks_enqueue_deleted_attachments
before delete on public.tasks
for each row execute function anttodo_private.enqueue_deleted_task_attachments();

grant select, update on public.attachment_cleanup_queue to service_role;
grant execute on function public.check_attachment_unreferenced(uuid, text) to service_role;

-- Process the durable queue independently of the deleting client. This also
-- covers the nightly purge of tasks that have spent 30 days in the trash.
create or replace function anttodo_private.invoke_attachment_cleanup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  dispatch_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'anttodo_project_url'
  limit 1;

  select decrypted_secret into dispatch_secret
  from vault.decrypted_secrets
  where name = 'anttodo_reminder_dispatch_secret'
  limit 1;

  if nullif(project_url, '') is null or nullif(dispatch_secret, '') is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/attachment-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-anttodo-dispatch-secret', dispatch_secret
    ),
    body := jsonb_build_object('scheduled_at', now())
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function anttodo_private.invoke_attachment_cleanup()
from public, anon, authenticated;
grant execute on function anttodo_private.invoke_attachment_cleanup() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'anttodo-attachment-cleanup') then
      perform cron.unschedule('anttodo-attachment-cleanup');
    end if;
    perform cron.schedule(
      'anttodo-attachment-cleanup',
      '* * * * *',
      'select anttodo_private.invoke_attachment_cleanup()'
    );
  end if;
end
$$;
