-- 1-minute sliding debounce buffer for task-change notifications.
-- Same (recipient, task, notification_type) merges; cross-scenario stays separate.
-- Due reminders continue to use reminder-dispatch unchanged.

create table anttodo_private.notification_dispatch_buffer (
  merge_key text primary key,
  workspace_id uuid not null,
  task_id uuid not null,
  comment_id uuid,
  recipient_id uuid not null,
  actor_id uuid not null,
  notification_type text not null,
  payload jsonb not null default '{}'::jsonb,
  available_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_dispatch_buffer_due_idx
  on anttodo_private.notification_dispatch_buffer(available_at);

create index notification_dispatch_buffer_recipient_task_idx
  on anttodo_private.notification_dispatch_buffer(recipient_id, task_id, notification_type);

create index notification_dispatch_buffer_comment_idx
  on anttodo_private.notification_dispatch_buffer(comment_id)
  where comment_id is not null;

revoke all on table anttodo_private.notification_dispatch_buffer
from public, anon, authenticated;

-- Merge payloads: keep first before, take latest after / other keys from incoming.
create or replace function anttodo_private.merge_notification_payloads(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_existing jsonb := coalesce(p_existing, '{}'::jsonb);
  v_incoming jsonb := coalesce(p_incoming, '{}'::jsonb);
  v_merged jsonb;
begin
  v_merged := v_existing || v_incoming;
  if v_existing ? 'before' then
    v_merged := jsonb_set(v_merged, '{before}', v_existing->'before', true);
  end if;
  return v_merged;
end;
$$;

revoke all on function anttodo_private.merge_notification_payloads(jsonb, jsonb)
from public, anon, authenticated;

create or replace function anttodo_private.create_app_notification(
  p_workspace_id uuid,
  p_task_id uuid,
  p_recipient_id uuid,
  p_actor_id uuid,
  p_notification_type text,
  p_comment_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merge_key text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_recipient_id is null
    or p_actor_id is null
    or p_workspace_id is null
    or p_task_id is null
    or nullif(btrim(p_notification_type), '') is null
    or not anttodo_private.can_user_view_task(p_task_id, p_recipient_id)
  then
    return null;
  end if;

  v_merge_key :=
    p_recipient_id::text || ':' || p_task_id::text || ':' || p_notification_type;

  insert into anttodo_private.notification_dispatch_buffer (
    merge_key,
    workspace_id,
    task_id,
    comment_id,
    recipient_id,
    actor_id,
    notification_type,
    payload,
    available_at,
    created_at,
    updated_at
  ) values (
    v_merge_key,
    p_workspace_id,
    p_task_id,
    p_comment_id,
    p_recipient_id,
    p_actor_id,
    p_notification_type,
    v_payload,
    now() + interval '1 minute',
    now(),
    now()
  )
  on conflict (merge_key) do update set
    workspace_id = excluded.workspace_id,
    task_id = excluded.task_id,
    comment_id = excluded.comment_id,
    actor_id = excluded.actor_id,
    payload = anttodo_private.merge_notification_payloads(
      anttodo_private.notification_dispatch_buffer.payload,
      excluded.payload
    ),
    available_at = now() + interval '1 minute',
    updated_at = now();

  return null;
end;
$$;

revoke all on function anttodo_private.create_app_notification(
  uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) from public, anon, authenticated;

create or replace function anttodo_private.flush_notification_dispatch_buffer()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r anttodo_private.notification_dispatch_buffer%rowtype;
  v_id uuid;
  v_dedupe text;
  v_count integer := 0;
begin
  for r in
    select *
    from anttodo_private.notification_dispatch_buffer
    where available_at <= now()
    order by available_at, merge_key
    for update skip locked
  loop
    v_dedupe :=
      'buffer:'
      || r.merge_key
      || ':'
      || extract(epoch from clock_timestamp())::text
      || ':'
      || extensions.gen_random_uuid()::text;

    insert into public.notifications (
      workspace_id,
      task_id,
      comment_id,
      recipient_id,
      actor_id,
      notification_type,
      payload,
      dedupe_key
    ) values (
      r.workspace_id,
      r.task_id,
      r.comment_id,
      r.recipient_id,
      r.actor_id,
      r.notification_type,
      coalesce(r.payload, '{}'::jsonb),
      v_dedupe
    )
    on conflict (recipient_id, notification_type, dedupe_key) do nothing
    returning id into v_id;

    if v_id is not null then
      perform anttodo_private.enqueue_notification_dispatch(v_id);
      v_count := v_count + 1;
    end if;

    delete from anttodo_private.notification_dispatch_buffer
    where merge_key = r.merge_key;
  end loop;

  return v_count;
end;
$$;

revoke all on function anttodo_private.flush_notification_dispatch_buffer()
from public, anon, authenticated;
grant execute on function anttodo_private.flush_notification_dispatch_buffer()
to service_role;

-- Force all pending rows due (used by pgTAP and intentional immediate drain).
create or replace function anttodo_private.force_flush_notification_dispatch_buffer()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  update anttodo_private.notification_dispatch_buffer
  set available_at = now() - interval '1 second'
  where available_at > now();

  return anttodo_private.flush_notification_dispatch_buffer();
end;
$$;

revoke all on function anttodo_private.force_flush_notification_dispatch_buffer()
from public, anon, authenticated;
grant execute on function anttodo_private.force_flush_notification_dispatch_buffer()
to service_role;

create or replace function anttodo_private.invoke_notification_buffer_flush()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return anttodo_private.flush_notification_dispatch_buffer();
end;
$$;

revoke all on function anttodo_private.invoke_notification_buffer_flush()
from public, anon, authenticated;
grant execute on function anttodo_private.invoke_notification_buffer_flush()
to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'anttodo-notification-buffer-flush') then
      perform cron.unschedule('anttodo-notification-buffer-flush');
    end if;
    perform cron.schedule(
      'anttodo-notification-buffer-flush',
      '* * * * *',
      'select anttodo_private.invoke_notification_buffer_flush()'
    );
  end if;
end
$$;

-- Cancel buffered comment fan-out when a mention supersedes it.
create or replace function anttodo_private.create_comment_mention_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_comment public.task_comments;
  current_kind text;
  selected_type text;
begin
  select * into current_comment
  from public.task_comments
  where id = new.comment_id;

  if not found
    or current_comment.author_id is distinct from (select auth.uid())
    or not anttodo_private.can_user_view_task(current_comment.task_id, new.user_id)
  then
    return new;
  end if;

  select t.kind into current_kind
  from public.tasks t
  where t.id = current_comment.task_id;

  selected_type := case
    when current_kind = 'note' then 'note_mentioned'
    else 'todo_mentioned'
  end;

  perform anttodo_private.create_app_notification(
    current_comment.workspace_id,
    current_comment.task_id,
    new.user_id,
    current_comment.author_id,
    selected_type,
    current_comment.id,
    jsonb_build_object('source', 'mention'),
    current_comment.id::text
  );

  -- Prefer the mention notification over the generic new-comment fan-out.
  delete from public.notifications notification
  where notification.comment_id = current_comment.id
    and notification.recipient_id = new.user_id
    and notification.notification_type in ('task_new_comment', 'participant_new_comment');

  delete from anttodo_private.notification_dispatch_buffer buffer
  where buffer.recipient_id = new.user_id
    and buffer.task_id = current_comment.task_id
    and buffer.notification_type in ('task_new_comment', 'participant_new_comment')
    and (
      buffer.comment_id = current_comment.id
      or coalesce(buffer.payload->>'comment_id', '') = current_comment.id::text
    );

  return new;
end;
$$;

create or replace function anttodo_private.remove_deleted_mention_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications notification
  where notification.comment_id = old.comment_id
    and notification.recipient_id = old.user_id
    and notification.notification_type in (
      'comment_mention',
      'todo_mentioned',
      'note_mentioned'
    );

  delete from anttodo_private.notification_dispatch_buffer buffer
  where buffer.recipient_id = old.user_id
    and buffer.comment_id = old.comment_id
    and buffer.notification_type in (
      'comment_mention',
      'todo_mentioned',
      'note_mentioned'
    );

  return old;
end;
$$;

create or replace function anttodo_private.remove_deleted_description_mention_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications notification
  where notification.task_id = old.task_id
    and notification.recipient_id = old.user_id
    and notification.comment_id is null
    and notification.notification_type in ('todo_mentioned', 'note_mentioned')
    and coalesce(notification.payload->>'source', '') = 'description';

  delete from anttodo_private.notification_dispatch_buffer buffer
  where buffer.task_id = old.task_id
    and buffer.recipient_id = old.user_id
    and buffer.comment_id is null
    and buffer.notification_type in ('todo_mentioned', 'note_mentioned')
    and coalesce(buffer.payload->>'source', '') = 'description';

  return old;
end;
$$;
