-- Description @mentions for todos/notes, plus 待办-被提及 preference scenario.

alter table public.user_notification_preferences
  drop constraint if exists user_notification_preferences_scenario_check;

alter table public.user_notification_preferences
  add constraint user_notification_preferences_scenario_check
  check (scenario in (
    'task_assigned',
    'task_due_reminder',
    'task_new_comment',
    'note_mentioned',
    'todo_mentioned',
    'participant_added',
    'participant_title_changed',
    'participant_status_changed',
    'participant_new_comment',
    'participant_subtask_created',
    'participant_subtask_status_changed',
    'participant_subtask_title_changed'
  ));

alter table public.notifications
  drop constraint if exists notifications_notification_type_check;

alter table public.notifications
  add constraint notifications_notification_type_check
  check (notification_type in (
    'comment_mention',
    'todo_mentioned',
    'task_assigned',
    'task_new_comment',
    'note_mentioned',
    'participant_added',
    'participant_title_changed',
    'participant_status_changed',
    'participant_new_comment',
    'participant_subtask_created',
    'participant_subtask_status_changed',
    'participant_subtask_title_changed'
  ));

create table public.task_description_mentions (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name_snapshot text not null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_description_mentions_user_idx
on public.task_description_mentions(user_id, created_at desc);

alter table public.task_description_mentions enable row level security;

create policy task_description_mentions_select
on public.task_description_mentions for select to authenticated
using ((select anttodo_private.can_view_task(task_id)));

create policy task_description_mentions_insert
on public.task_description_mentions for insert to authenticated
with check (
  user_id <> (select auth.uid())
  and (select anttodo_private.can_edit_task(task_id))
  and anttodo_private.can_user_view_task(task_id, user_id)
);

create policy task_description_mentions_delete
on public.task_description_mentions for delete to authenticated
using ((select anttodo_private.can_edit_task(task_id)));

grant select, insert, delete on public.task_description_mentions to authenticated;
grant all on public.task_description_mentions to service_role;

create or replace function anttodo_private.create_description_mention_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_task public.tasks;
  selected_type text;
  v_actor uuid := (select auth.uid());
begin
  select * into current_task
  from public.tasks
  where id = new.task_id;

  if not found
    or v_actor is null
    or not anttodo_private.can_user_view_task(current_task.id, new.user_id)
  then
    return new;
  end if;

  selected_type := case
    when current_task.kind = 'note' then 'note_mentioned'
    else 'todo_mentioned'
  end;

  perform anttodo_private.create_app_notification(
    current_task.workspace_id,
    current_task.id,
    new.user_id,
    v_actor,
    selected_type,
    null,
    jsonb_build_object('source', 'description'),
    'description:' || current_task.id::text || ':' || new.user_id::text || ':' ||
      extract(epoch from new.created_at)::text
  );

  return new;
end;
$$;

revoke all on function anttodo_private.create_description_mention_notification()
from public, anon, authenticated;

create trigger task_description_mentions_notify
after insert on public.task_description_mentions
for each row execute function anttodo_private.create_description_mention_notification();

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
  return old;
end;
$$;

revoke all on function anttodo_private.remove_deleted_description_mention_notification()
from public, anon, authenticated;

create trigger task_description_mentions_remove_notification
after delete on public.task_description_mentions
for each row execute function anttodo_private.remove_deleted_description_mention_notification();

-- Todo comment @mentions also use 待办-被提及 going forward.
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
    and notification.notification_type in (
      'comment_mention',
      'todo_mentioned',
      'note_mentioned'
    );
  return old;
end;
$$;

create or replace function public.update_task_description(
  p_task_id uuid,
  p_description text,
  p_mentioned_user_ids uuid[] default array[]::uuid[]
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_task public.tasks;
begin
  if not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  update public.tasks
  set description = coalesce(p_description, ''),
      updated_at = now(),
      version = version + 1
  where id = p_task_id
  returning * into updated_task;

  if not found then
    raise exception 'Task not found'
      using errcode = 'P0002';
  end if;

  delete from public.task_description_mentions mention
  where mention.task_id = updated_task.id
    and not (
      mention.user_id = any(coalesce(p_mentioned_user_ids, array[]::uuid[]))
      and anttodo_private.can_user_view_task(updated_task.id, mention.user_id)
    );

  insert into public.task_description_mentions (
    task_id,
    user_id,
    display_name_snapshot
  )
  select
    updated_task.id,
    profile.id,
    coalesce(nullif(btrim(profile.display_name), ''), '团队成员')
  from public.profiles profile
  where profile.id = any(coalesce(p_mentioned_user_ids, array[]::uuid[]))
    and profile.id <> (select auth.uid())
    and anttodo_private.can_user_view_task(updated_task.id, profile.id)
  on conflict (task_id, user_id) do nothing;

  return updated_task;
end;
$$;

revoke all on function public.update_task_description(uuid, text, uuid[])
from public, anon;
grant execute on function public.update_task_description(uuid, text, uuid[])
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_description_mentions'
    )
  then
    alter publication supabase_realtime add table public.task_description_mentions;
  end if;
end;
$$;
