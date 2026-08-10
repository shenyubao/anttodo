-- Allow actor == recipient notifications so self-actions can be tested end-to-end.

drop policy if exists task_comment_mentions_insert on public.task_comment_mentions;
create policy task_comment_mentions_insert
on public.task_comment_mentions for insert to authenticated
with check (
  exists (
    select 1 from public.task_comments comment
    where comment.id = comment_id
      and comment.author_id = (select auth.uid())
      and (select anttodo_private.can_view_task(comment.task_id))
      and anttodo_private.can_user_view_task(comment.task_id, user_id)
  )
);

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

create or replace function public.create_task_comment(
  p_task_id uuid,
  p_body text default '',
  p_image_uris text[] default array[]::text[],
  p_mentioned_user_ids uuid[] default array[]::uuid[],
  p_subtask_id uuid default null
)
returns public.task_comments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_comment public.task_comments;
  current_task public.tasks%rowtype;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id;

  if not found or not anttodo_private.can_view_task(p_task_id) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  if p_subtask_id is not null and not exists (
    select 1 from public.subtasks subtask
    where subtask.id = p_subtask_id
      and subtask.task_id = p_task_id
  ) then
    raise exception 'Comment subtask does not belong to task'
      using errcode = '23514';
  end if;

  insert into public.task_comments (
    workspace_id,
    task_id,
    subtask_id,
    author_id,
    body,
    image_uris
  ) values (
    current_task.workspace_id,
    current_task.id,
    p_subtask_id,
    (select auth.uid()),
    coalesce(p_body, ''),
    coalesce(p_image_uris, array[]::text[])
  ) returning * into created_comment;

  insert into public.task_comment_mentions (
    comment_id,
    user_id,
    display_name_snapshot
  )
  select
    created_comment.id,
    profile.id,
    coalesce(nullif(btrim(profile.display_name), ''), '团队成员')
  from public.profiles profile
  where profile.id = any(coalesce(p_mentioned_user_ids, array[]::uuid[]))
    and anttodo_private.can_user_view_task(created_comment.task_id, profile.id)
  on conflict (comment_id, user_id) do nothing;

  return created_comment;
end;
$$;

create or replace function public.update_task_comment(
  p_comment_id uuid,
  p_body text,
  p_image_uris text[] default array[]::text[],
  p_mentioned_user_ids uuid[] default array[]::uuid[]
)
returns public.task_comments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_comment public.task_comments;
begin
  if not exists (
    select 1 from public.task_comments comment
    where comment.id = p_comment_id
      and comment.author_id = (select auth.uid())
      and anttodo_private.can_view_task(comment.task_id)
  ) then
    raise exception 'Insufficient comment permission'
      using errcode = '42501';
  end if;

  update public.task_comments
  set body = coalesce(p_body, ''),
      image_uris = coalesce(p_image_uris, array[]::text[]),
      updated_at = now()
  where id = p_comment_id
  returning * into updated_comment;

  delete from public.task_comment_mentions mention
  where mention.comment_id = updated_comment.id
    and not (
      mention.user_id = any(coalesce(p_mentioned_user_ids, array[]::uuid[]))
      and anttodo_private.can_user_view_task(updated_comment.task_id, mention.user_id)
    );

  insert into public.task_comment_mentions (
    comment_id,
    user_id,
    display_name_snapshot
  )
  select
    updated_comment.id,
    profile.id,
    coalesce(nullif(btrim(profile.display_name), ''), '团队成员')
  from public.profiles profile
  where profile.id = any(coalesce(p_mentioned_user_ids, array[]::uuid[]))
    and anttodo_private.can_user_view_task(updated_comment.task_id, profile.id)
  on conflict (comment_id, user_id) do nothing;

  return updated_comment;
end;
$$;
