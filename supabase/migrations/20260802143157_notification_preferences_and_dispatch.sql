-- Notification preferences, expanded notification types, DingTalk userid cache,
-- fan-out triggers, and dispatch enqueue via pg_net.

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

create table public.user_notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  scenario text not null check (scenario in (
    'task_assigned',
    'task_due_reminder',
    'task_new_comment',
    'note_mentioned',
    'participant_title_changed',
    'participant_status_changed',
    'participant_new_comment',
    'participant_subtask_created',
    'participant_subtask_status_changed',
    'participant_subtask_title_changed'
  )),
  system_enabled boolean not null default true,
  dingtalk_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, scenario)
);

alter table public.user_notification_preferences enable row level security;

create policy user_notification_preferences_select_self
on public.user_notification_preferences
for select to authenticated
using (user_id = (select auth.uid()));

create policy user_notification_preferences_insert_self
on public.user_notification_preferences
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy user_notification_preferences_update_self
on public.user_notification_preferences
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant select, insert, update on public.user_notification_preferences to authenticated;

create or replace function anttodo_private.notification_pref_enabled(
  p_user_id uuid,
  p_scenario text,
  p_channel text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_channel = 'system' then coalesce(
      (
        select system_enabled
        from public.user_notification_preferences
        where user_id = p_user_id and scenario = p_scenario
      ),
      true
    )
    when p_channel = 'dingtalk' then coalesce(
      (
        select dingtalk_enabled
        from public.user_notification_preferences
        where user_id = p_user_id and scenario = p_scenario
      ),
      true
    )
    else false
  end;
$$;

revoke all on function anttodo_private.notification_pref_enabled(uuid, text, text)
from public, anon, authenticated;
grant execute on function anttodo_private.notification_pref_enabled(uuid, text, text)
to service_role;

-- ---------------------------------------------------------------------------
-- Expand notifications
-- ---------------------------------------------------------------------------

alter table public.notifications
  alter column comment_id drop not null;

alter table public.notifications
  drop constraint if exists notifications_notification_type_check;

alter table public.notifications
  add constraint notifications_notification_type_check
  check (notification_type in (
    'comment_mention',
    'task_assigned',
    'task_new_comment',
    'note_mentioned',
    'participant_title_changed',
    'participant_status_changed',
    'participant_new_comment',
    'participant_subtask_created',
    'participant_subtask_status_changed',
    'participant_subtask_title_changed'
  ));

alter table public.notifications
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.notifications
  add column if not exists dedupe_key text;

update public.notifications
set dedupe_key = coalesce(comment_id::text, id::text)
where dedupe_key is null;

alter table public.notifications
  alter column dedupe_key set not null;

alter table public.notifications
  drop constraint if exists notifications_comment_id_recipient_id_notification_type_key;

alter table public.notifications
  add constraint notifications_recipient_type_dedupe_key
  unique (recipient_id, notification_type, dedupe_key);

-- ---------------------------------------------------------------------------
-- DingTalk userid cache on SSO identities
-- ---------------------------------------------------------------------------

alter table public.sso_identities
  add column if not exists dingtalk_userid text;

-- ---------------------------------------------------------------------------
-- Dispatch enqueue
-- ---------------------------------------------------------------------------

create or replace function anttodo_private.enqueue_notification_dispatch(
  p_notification_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'anttodo_project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'anttodo_reminder_dispatch_secret' limit 1;
  if nullif(v_url, '') is null or nullif(v_secret, '') is null then
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/notification-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-anttodo-dispatch-secret', v_secret
    ),
    body := jsonb_build_object('notification_id', p_notification_id)
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function anttodo_private.enqueue_notification_dispatch(uuid)
from public, anon, authenticated;
grant execute on function anttodo_private.enqueue_notification_dispatch(uuid)
to service_role;

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
  v_id uuid;
  v_dedupe text := coalesce(nullif(btrim(p_dedupe_key), ''), extensions.gen_random_uuid()::text);
begin
  if p_recipient_id is null
    or p_actor_id is null
    or p_recipient_id = p_actor_id
    or not anttodo_private.can_user_view_task(p_task_id, p_recipient_id)
  then
    return null;
  end if;

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
    p_workspace_id,
    p_task_id,
    p_comment_id,
    p_recipient_id,
    p_actor_id,
    p_notification_type,
    coalesce(p_payload, '{}'::jsonb),
    v_dedupe
  )
  on conflict (recipient_id, notification_type, dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null then
    perform anttodo_private.enqueue_notification_dispatch(v_id);
  end if;
  return v_id;
end;
$$;

revoke all on function anttodo_private.create_app_notification(
  uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) from public, anon, authenticated;

create or replace function anttodo_private.notify_task_participants(
  p_workspace_id uuid,
  p_task_id uuid,
  p_actor_id uuid,
  p_notification_type text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_prefix text default null,
  p_exclude_user_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select tp.user_id
    from public.task_participants tp
    where tp.task_id = p_task_id
      and tp.user_id is distinct from p_actor_id
      and not (tp.user_id = any(coalesce(p_exclude_user_ids, array[]::uuid[])))
  loop
    perform anttodo_private.create_app_notification(
      p_workspace_id,
      p_task_id,
      v_user_id,
      p_actor_id,
      p_notification_type,
      null,
      p_payload,
      case
        when p_dedupe_prefix is null then null
        else p_dedupe_prefix || ':' || v_user_id::text
      end
    );
  end loop;
end;
$$;

revoke all on function anttodo_private.notify_task_participants(
  uuid, uuid, uuid, text, jsonb, text, uuid[]
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mentions: note_mentioned vs comment_mention (todo)
-- ---------------------------------------------------------------------------

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
    or new.user_id = current_comment.author_id
    or not anttodo_private.can_user_view_task(current_comment.task_id, new.user_id)
  then
    return new;
  end if;

  select t.kind into current_kind
  from public.tasks t
  where t.id = current_comment.task_id;

  selected_type := case
    when current_kind = 'note' then 'note_mentioned'
    else 'comment_mention'
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
    and notification.notification_type in ('comment_mention', 'note_mentioned');
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assignment + participant title/status
-- ---------------------------------------------------------------------------

create or replace function anttodo_private.notify_task_field_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    return new;
  end if;

  if old.assignee_id is distinct from new.assignee_id
    and new.assignee_id is not null
  then
    perform anttodo_private.create_app_notification(
      new.workspace_id,
      new.id,
      new.assignee_id,
      v_actor,
      'task_assigned',
      null,
      jsonb_build_object(
        'before', old.assignee_id,
        'after', new.assignee_id,
        'title', new.title
      ),
      'assign:' || new.id::text || ':' || new.assignee_id::text || ':' || extract(epoch from clock_timestamp())::text
    );
  end if;

  if old.title is distinct from new.title then
    perform anttodo_private.notify_task_participants(
      new.workspace_id,
      new.id,
      v_actor,
      'participant_title_changed',
      jsonb_build_object('before', old.title, 'after', new.title),
      'title:' || new.id::text || ':' || extract(epoch from clock_timestamp())::text
    );
  end if;

  if old.status is distinct from new.status then
    perform anttodo_private.notify_task_participants(
      new.workspace_id,
      new.id,
      v_actor,
      'participant_status_changed',
      jsonb_build_object('before', old.status, 'after', new.status, 'title', new.title),
      'status:' || new.id::text || ':' || extract(epoch from clock_timestamp())::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_notify_field_changes on public.tasks;
create trigger tasks_notify_field_changes
after update of assignee_id, title, status on public.tasks
for each row execute function anttodo_private.notify_task_field_changes();

-- ---------------------------------------------------------------------------
-- New comments → assignee + participants
-- ---------------------------------------------------------------------------

create or replace function anttodo_private.notify_new_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee uuid;
  v_kind text;
  v_exclude uuid[] := array[]::uuid[];
begin
  select t.assignee_id, t.kind
  into v_assignee, v_kind
  from public.tasks t
  where t.id = new.task_id;

  if v_kind is distinct from 'note'
    and v_assignee is not null
    and v_assignee is distinct from new.author_id
  then
    perform anttodo_private.create_app_notification(
      new.workspace_id,
      new.task_id,
      v_assignee,
      new.author_id,
      'task_new_comment',
      new.id,
      jsonb_build_object('title', (select title from public.tasks where id = new.task_id)),
      'comment:' || new.id::text || ':' || v_assignee::text
    );
    v_exclude := array_append(v_exclude, v_assignee);
  end if;

  -- Mentioned users already get mention notifications; still notify other participants.
  perform anttodo_private.notify_task_participants(
    new.workspace_id,
    new.task_id,
    new.author_id,
    'participant_new_comment',
    jsonb_build_object('comment_id', new.id),
    'pcomment:' || new.id::text,
    v_exclude
  );

  return new;
end;
$$;

drop trigger if exists task_comments_notify_new on public.task_comments;
create trigger task_comments_notify_new
after insert on public.task_comments
for each row execute function anttodo_private.notify_new_task_comment();

-- ---------------------------------------------------------------------------
-- Subtask participant notifications
-- ---------------------------------------------------------------------------

create or replace function anttodo_private.notify_subtask_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_workspace_id uuid;
  v_task_id uuid := coalesce(new.task_id, old.task_id);
begin
  if v_actor is null then
    return coalesce(new, old);
  end if;

  select t.workspace_id into v_workspace_id
  from public.tasks t
  where t.id = v_task_id;
  if v_workspace_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    perform anttodo_private.notify_task_participants(
      v_workspace_id,
      v_task_id,
      v_actor,
      'participant_subtask_created',
      jsonb_build_object('subtask_id', new.id, 'title', new.title),
      'subcreate:' || new.id::text
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.title is distinct from new.title then
      perform anttodo_private.notify_task_participants(
        v_workspace_id,
        v_task_id,
        v_actor,
        'participant_subtask_title_changed',
        jsonb_build_object(
          'subtask_id', new.id,
          'before', old.title,
          'after', new.title
        ),
        'subtitle:' || new.id::text || ':' || extract(epoch from clock_timestamp())::text
      );
    end if;
    if old.completed is distinct from new.completed then
      perform anttodo_private.notify_task_participants(
        v_workspace_id,
        v_task_id,
        v_actor,
        'participant_subtask_status_changed',
        jsonb_build_object(
          'subtask_id', new.id,
          'title', new.title,
          'before', old.completed,
          'after', new.completed
        ),
        'substatus:' || new.id::text || ':' || extract(epoch from clock_timestamp())::text
      );
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists subtasks_notify_changes on public.subtasks;
create trigger subtasks_notify_changes
after insert or update of title, completed on public.subtasks
for each row execute function anttodo_private.notify_subtask_changes();

-- Expose pref helper for authenticated preference reads via RPC (optional service use).
create or replace function public.notification_pref_enabled(
  p_scenario text,
  p_channel text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select anttodo_private.notification_pref_enabled(
    (select auth.uid()),
    p_scenario,
    p_channel
  );
$$;

revoke all on function public.notification_pref_enabled(text, text)
from public, anon;
grant execute on function public.notification_pref_enabled(text, text)
to authenticated, service_role;
