create table public.custom_task_views (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  definition jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, name)
);

create index custom_task_views_user_idx
  on public.custom_task_views(workspace_id, user_id, position, created_at);

create table public.task_system_view_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  view_key text not null check (view_key in (
    'all', 'today', 'week', 'assigned', 'watching', 'inbox', 'trash'
  )),
  visible boolean not null default true,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id, view_key)
);

create trigger custom_task_views_updated_at
before update on public.custom_task_views
for each row execute function anttodo_private.set_updated_at();

create trigger task_system_view_preferences_updated_at
before update on public.task_system_view_preferences
for each row execute function anttodo_private.set_updated_at();

create or replace function anttodo_private.cleanup_custom_task_view()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.task_list_placements where list_key = 'custom:' || old.id::text;
  delete from public.task_sections where list_key = 'custom:' || old.id::text;
  delete from public.task_list_preferences where list_key = 'custom:' || old.id::text;
  return old;
end;
$$;

create trigger custom_task_views_cleanup
after delete on public.custom_task_views
for each row execute function anttodo_private.cleanup_custom_task_view();

create or replace function anttodo_private.prevent_custom_task_view_definition_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is distinct from old.name
    or new.definition is distinct from old.definition
    or new.workspace_id is distinct from old.workspace_id
    or new.user_id is distinct from old.user_id
  then
    raise exception 'Custom task view definition is immutable';
  end if;
  return new;
end;
$$;

create trigger custom_task_views_immutable_definition
before update on public.custom_task_views
for each row execute function anttodo_private.prevent_custom_task_view_definition_edit();

alter table public.custom_task_views enable row level security;
alter table public.task_system_view_preferences enable row level security;

create policy custom_task_views_select
on public.custom_task_views for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy custom_task_views_insert
on public.custom_task_views for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy custom_task_views_delete
on public.custom_task_views for delete to authenticated
using (user_id = (select auth.uid()));

create policy custom_task_views_update_visibility
on public.custom_task_views for update to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy task_system_view_preferences_select
on public.task_system_view_preferences for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy task_system_view_preferences_insert
on public.task_system_view_preferences for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy task_system_view_preferences_update
on public.task_system_view_preferences for update to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy task_system_view_preferences_delete
on public.task_system_view_preferences for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.custom_task_views to authenticated;
grant select, insert, update, delete on public.task_system_view_preferences to authenticated;

alter table public.task_list_preferences
  drop constraint if exists task_list_preferences_list_key_check;
alter table public.task_list_preferences
  add constraint task_list_preferences_list_key_check check (
    list_key in ('all', 'today', 'assigned', 'inbox')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

alter table public.task_sections
  drop constraint if exists task_sections_list_key_check;
alter table public.task_sections
  add constraint task_sections_list_key_check check (
    list_key in ('all', 'today', 'assigned', 'inbox')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or list_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

alter table public.task_list_placements
  drop constraint if exists task_list_placements_list_key_check;
alter table public.task_list_placements
  add constraint task_list_placements_list_key_check check (
    list_key in ('all', 'today', 'assigned', 'inbox')
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
    when target_list_key in ('all', 'today', 'assigned', 'inbox')
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
    when target_list_key in ('all', 'today', 'assigned', 'inbox')
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
