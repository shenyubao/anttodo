create table public.task_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 10000),
  image_uris text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  check (
    nullif(btrim(body), '') is not null
    or coalesce(array_length(image_uris, 1), 0) > 0
  ),
  check (coalesce(array_length(image_uris, 1), 0) <= 8)
);

create table public.task_comment_mentions (
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name_snapshot text not null check (char_length(display_name_snapshot) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (notification_type = 'comment_mention'),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (comment_id, recipient_id, notification_type)
);

create index task_comments_task_created_idx
on public.task_comments(task_id, created_at);
create index task_comments_author_idx
on public.task_comments(author_id);
create index task_comment_mentions_user_idx
on public.task_comment_mentions(user_id, created_at desc);
create index notifications_recipient_created_idx
on public.notifications(recipient_id, workspace_id, created_at desc);
create index notifications_recipient_unread_idx
on public.notifications(recipient_id, workspace_id, created_at desc)
where read_at is null;
create index notifications_task_idx on public.notifications(task_id);
create index notifications_actor_idx on public.notifications(actor_id);

create or replace function anttodo_private.valid_comment_image_uri(
  image_uri text,
  target_workspace uuid,
  target_task uuid,
  target_author uuid
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select image_uri ~* (
    '^anttodo-storage://comment-images/' || target_workspace::text || '/' ||
    target_task::text || '/' || target_author::text || '/' ||
    '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(gif|jpe?g|png|webp)$'
  );
$$;

revoke all on function anttodo_private.valid_comment_image_uri(text, uuid, uuid, uuid)
from public, anon;
grant execute on function anttodo_private.valid_comment_image_uri(text, uuid, uuid, uuid)
to authenticated;

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

create trigger task_comments_validate
before insert on public.task_comments
for each row execute function anttodo_private.validate_task_comment();

create or replace function anttodo_private.create_comment_mention_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_comment public.task_comments%rowtype;
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

  insert into public.notifications (
    workspace_id,
    task_id,
    comment_id,
    recipient_id,
    actor_id,
    notification_type
  ) values (
    current_comment.workspace_id,
    current_comment.task_id,
    current_comment.id,
    new.user_id,
    current_comment.author_id,
    'comment_mention'
  ) on conflict (comment_id, recipient_id, notification_type) do nothing;

  return new;
end;
$$;

revoke all on function anttodo_private.create_comment_mention_notification()
from public, anon, authenticated;

create trigger task_comment_mentions_notify
after insert on public.task_comment_mentions
for each row execute function anttodo_private.create_comment_mention_notification();

create or replace function public.create_task_comment(
  p_task_id uuid,
  p_body text default '',
  p_image_uris text[] default array[]::text[],
  p_mentioned_user_ids uuid[] default array[]::uuid[]
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

  insert into public.task_comments (
    workspace_id,
    task_id,
    author_id,
    body,
    image_uris
  ) values (
    current_task.workspace_id,
    current_task.id,
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

create or replace function public.list_task_comment_candidates(p_task_id uuid)
returns table(user_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not anttodo_private.can_view_task(p_task_id) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  return query
  select member.user_id
  from public.workspace_members member
  join public.tasks task on task.workspace_id = member.workspace_id
  where task.id = p_task_id
    and anttodo_private.can_user_view_task(p_task_id, member.user_id);
end;
$$;

revoke all on function public.create_task_comment(uuid, text, text[], uuid[])
from public, anon;
grant execute on function public.create_task_comment(uuid, text, text[], uuid[])
to authenticated;
revoke all on function public.list_task_comment_candidates(uuid)
from public, anon;
grant execute on function public.list_task_comment_candidates(uuid)
to authenticated;

alter table public.task_comments enable row level security;
alter table public.task_comment_mentions enable row level security;
alter table public.notifications enable row level security;

create policy task_comments_select
on public.task_comments for select to authenticated
using ((select anttodo_private.can_view_task(task_id)));

create policy task_comments_insert
on public.task_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select anttodo_private.can_view_task(task_id))
);

create policy task_comments_delete
on public.task_comments for delete to authenticated
using (
  author_id = (select auth.uid())
  and (select anttodo_private.can_view_task(task_id))
);

create policy task_comment_mentions_select
on public.task_comment_mentions for select to authenticated
using (
  exists (
    select 1 from public.task_comments comment
    where comment.id = comment_id
      and (select anttodo_private.can_view_task(comment.task_id))
  )
);

create policy task_comment_mentions_insert
on public.task_comment_mentions for insert to authenticated
with check (
  user_id <> (select auth.uid())
  and exists (
    select 1 from public.task_comments comment
    where comment.id = comment_id
      and comment.author_id = (select auth.uid())
      and (select anttodo_private.can_view_task(comment.task_id))
      and anttodo_private.can_user_view_task(comment.task_id, user_id)
  )
);

create policy notifications_select
on public.notifications for select to authenticated
using (
  recipient_id = (select auth.uid())
  and (select anttodo_private.can_view_task(task_id))
);

create policy notifications_update
on public.notifications for update to authenticated
using (
  recipient_id = (select auth.uid())
  and (select anttodo_private.can_view_task(task_id))
)
with check (
  recipient_id = (select auth.uid())
  and (select anttodo_private.can_view_task(task_id))
);

grant select, insert, delete on public.task_comments to authenticated;
grant select, insert on public.task_comment_mentions to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.task_comments, public.task_comment_mentions, public.notifications
to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'comment-images',
  'comment-images',
  false,
  20971520,
  array['image/gif', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function anttodo_private.comment_image_folder_id(
  object_name text,
  folder_index integer
)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  folders text[] := storage.foldername(object_name);
begin
  if coalesce(array_length(folders, 1), 0) <> 3
    or folder_index not between 1 and 3
    or folders[folder_index] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return null;
  end if;
  return folders[folder_index]::uuid;
end;
$$;

revoke all on function anttodo_private.comment_image_folder_id(text, integer)
from public, anon;
grant execute on function anttodo_private.comment_image_folder_id(text, integer)
to authenticated;

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
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(gif|jpe?g|png|webp)$'
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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'task_comments', 'task_comment_mentions', 'notifications'
  ] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;
