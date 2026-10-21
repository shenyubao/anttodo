-- Remove user-space sidebar shortcuts and member-specific task lists.

delete from public.task_list_placements where list_key like 'user:%';
delete from public.task_sections where list_key like 'user:%';
delete from public.task_list_preferences where list_key like 'user:%';

drop table if exists public.user_sidebar_members;

alter table public.task_list_preferences
  drop constraint if exists task_list_preferences_list_key_check;
alter table public.task_list_preferences
  add constraint task_list_preferences_list_key_check check (
    list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

alter table public.task_sections
  drop constraint if exists task_sections_list_key_check;
alter table public.task_sections
  add constraint task_sections_list_key_check check (
    list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

alter table public.task_list_placements
  drop constraint if exists task_list_placements_list_key_check;
alter table public.task_list_placements
  add constraint task_list_placements_list_key_check check (
    list_key in ('all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
    else false
  end;
$$;
