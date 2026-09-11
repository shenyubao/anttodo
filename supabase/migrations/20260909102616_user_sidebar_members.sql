-- Per-user shortcuts for assignee task views.

create table public.user_sidebar_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- No direct FK to workspaces: two membership FKs plus workspaces(id) makes
  -- PostgREST treat this as a junction and reject workspace_members embeds.
  workspace_id uuid not null,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, workspace_id, member_user_id),
  constraint user_sidebar_members_not_self check (user_id <> member_user_id),
  constraint user_sidebar_members_viewer_fkey
    foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete cascade,
  constraint user_sidebar_members_target_fkey
    foreign key (workspace_id, member_user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete cascade
);

create index user_sidebar_members_user_workspace_created_idx
  on public.user_sidebar_members(user_id, workspace_id, created_at, member_user_id);

alter table public.user_sidebar_members enable row level security;

create policy user_sidebar_members_select_self
on public.user_sidebar_members for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy user_sidebar_members_insert_self
on public.user_sidebar_members for insert to authenticated
with check (
  user_id = (select auth.uid())
  and user_id <> member_user_id
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy user_sidebar_members_delete_self
on public.user_sidebar_members for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, delete on public.user_sidebar_members to authenticated;

alter table public.task_list_preferences
  drop constraint if exists task_list_preferences_list_key_check;
alter table public.task_list_preferences
  add constraint task_list_preferences_list_key_check check (
    list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

alter table public.task_sections
  drop constraint if exists task_sections_list_key_check;
alter table public.task_sections
  add constraint task_sections_list_key_check check (
    list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

alter table public.task_list_placements
  drop constraint if exists task_list_placements_list_key_check;
alter table public.task_list_placements
  add constraint task_list_placements_list_key_check check (
    list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

create or replace function anttodo_private.can_view_task_list(
  target_workspace uuid,
  target_list_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
      then anttodo_private.is_workspace_member(target_workspace)
    when target_list_key like 'label:%'
      then exists (
        select 1
        from public.labels l
        where l.id = substring(target_list_key from 7)::uuid
          and l.workspace_id = target_workspace
          and anttodo_private.label_permission_level(l.id) >= 1
      )
    when target_list_key like 'custom:%'
      then exists (
        select 1
        from public.custom_task_views v
        where v.id = substring(target_list_key from 8)::uuid
          and v.workspace_id = target_workspace
          and v.user_id = (select auth.uid())
      )
    when target_list_key ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then anttodo_private.is_workspace_member(target_workspace)
        and exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = target_workspace
            and wm.user_id = substring(target_list_key from 6)::uuid
        )
    else false
  end;
$$;

create or replace function anttodo_private.can_edit_task_list(
  target_workspace uuid,
  target_list_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
      then anttodo_private.is_workspace_member(target_workspace)
    when target_list_key like 'label:%'
      then exists (
        select 1
        from public.labels l
        where l.id = substring(target_list_key from 7)::uuid
          and l.workspace_id = target_workspace
          and anttodo_private.label_permission_level(l.id) >= 2
      )
    when target_list_key like 'custom:%'
      then exists (
        select 1
        from public.custom_task_views v
        where v.id = substring(target_list_key from 8)::uuid
          and v.workspace_id = target_workspace
          and v.user_id = (select auth.uid())
      )
    when target_list_key ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then anttodo_private.is_workspace_member(target_workspace)
        and exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = target_workspace
            and wm.user_id = substring(target_list_key from 6)::uuid
        )
    else false
  end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_sidebar_members'
    )
  then
    alter publication supabase_realtime add table public.user_sidebar_members;
  end if;
end;
$$;
