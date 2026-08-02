alter table public.task_comments
add column updated_at timestamptz not null default now();

create policy task_comments_update
on public.task_comments for update to authenticated
using (
  author_id = (select auth.uid())
  and (select anttodo_private.can_view_task(task_id))
)
with check (
  author_id = (select auth.uid())
  and (select anttodo_private.can_view_task(task_id))
);

create policy task_comment_mentions_delete
on public.task_comment_mentions for delete to authenticated
using (
  exists (
    select 1 from public.task_comments comment
    where comment.id = comment_id
      and comment.author_id = (select auth.uid())
      and (select anttodo_private.can_view_task(comment.task_id))
  )
);

grant update (body, image_uris, updated_at) on public.task_comments to authenticated;
grant delete on public.task_comment_mentions to authenticated;

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
    and notification.notification_type = 'comment_mention';
  return old;
end;
$$;

revoke all on function anttodo_private.remove_deleted_mention_notification()
from public, anon, authenticated;

create trigger task_comment_mentions_remove_notification
after delete on public.task_comment_mentions
for each row execute function anttodo_private.remove_deleted_mention_notification();

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
    and profile.id <> updated_comment.author_id
    and anttodo_private.can_user_view_task(updated_comment.task_id, profile.id)
  on conflict (comment_id, user_id) do nothing;

  return updated_comment;
end;
$$;

revoke all on function public.update_task_comment(uuid, text, text[], uuid[])
from public, anon;
grant execute on function public.update_task_comment(uuid, text, text[], uuid[])
to authenticated;
