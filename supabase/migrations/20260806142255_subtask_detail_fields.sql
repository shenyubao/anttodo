-- Subtasks gain description + effort hours; comments can target a subtask.

alter table public.subtasks
  add column description text not null default '',
  add column estimate_hours numeric(8, 1) null,
  add column actual_hours numeric(8, 1) null;

alter table public.subtasks
  add constraint subtasks_estimate_hours_non_negative
    check (estimate_hours is null or estimate_hours >= 0),
  add constraint subtasks_actual_hours_non_negative
    check (actual_hours is null or actual_hours >= 0);

alter table public.task_comments
  add column subtask_id uuid references public.subtasks(id) on delete cascade;

create index task_comments_subtask_created_idx
  on public.task_comments(subtask_id, created_at)
  where subtask_id is not null;

create or replace function anttodo_private.validate_task_comment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tasks task
    where task.id = new.task_id
      and task.workspace_id = new.workspace_id
  ) then
    raise exception 'Comment task and workspace do not match'
      using errcode = '23514';
  end if;

  if new.subtask_id is not null and not exists (
    select 1 from public.subtasks subtask
    where subtask.id = new.subtask_id
      and subtask.task_id = new.task_id
  ) then
    raise exception 'Comment subtask does not belong to task'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from unnest(new.image_uris) image_uri
    where not anttodo_private.valid_comment_image_uri(
      image_uri,
      new.workspace_id,
      new.task_id,
      new.author_id
    )
  ) then
    raise exception 'Invalid comment image URI'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop function if exists public.create_task_comment(uuid, text, text[], uuid[]);

create function public.create_task_comment(
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
    and profile.id <> created_comment.author_id
    and anttodo_private.can_user_view_task(created_comment.task_id, profile.id)
  on conflict (comment_id, user_id) do nothing;

  return created_comment;
end;
$$;

revoke all on function public.create_task_comment(uuid, text, text[], uuid[], uuid)
from public, anon;
grant execute on function public.create_task_comment(uuid, text, text[], uuid[], uuid)
to authenticated;
