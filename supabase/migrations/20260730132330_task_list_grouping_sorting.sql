create type public.task_list_grouping as enum (
  'custom', 'due', 'created', 'label', 'priority', 'assignee', 'none'
);

create type public.task_list_sort as enum (
  'custom', 'due', 'created', 'updated', 'title', 'label', 'priority', 'assignee'
);

create type public.sort_direction as enum ('asc', 'desc');

create table public.task_list_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  list_key text not null check (
    list_key in ('all', 'today', 'assigned', 'inbox')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  grouping public.task_list_grouping not null default 'custom',
  sort public.task_list_sort not null default 'custom',
  direction public.sort_direction not null default 'asc',
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id, list_key)
);

create table public.task_sections (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  list_key text not null check (
    list_key in ('all', 'today', 'assigned', 'inbox')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  position integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_list_placements (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  list_key text not null check (
    list_key in ('all', 'today', 'assigned', 'inbox')
    or list_key ~ '^label:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  task_id uuid not null references public.tasks(id) on delete cascade,
  section_id uuid references public.task_sections(id) on delete set null,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, list_key, task_id)
);

create index task_sections_list_idx
  on public.task_sections(workspace_id, list_key, position);
create index task_list_placements_list_idx
  on public.task_list_placements(workspace_id, list_key, section_id, position);
create index task_list_placements_task_idx
  on public.task_list_placements(task_id);

create trigger task_list_preferences_updated_at
before update on public.task_list_preferences
for each row execute function anttodo_private.set_updated_at();

create trigger task_sections_updated_at
before update on public.task_sections
for each row execute function anttodo_private.set_updated_at();

create trigger task_list_placements_updated_at
before update on public.task_list_placements
for each row execute function anttodo_private.set_updated_at();

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
    else false
  end;
$$;

revoke all on function anttodo_private.can_view_task_list(uuid, text) from public, anon;
revoke all on function anttodo_private.can_edit_task_list(uuid, text) from public, anon;
grant execute on function anttodo_private.can_view_task_list(uuid, text) to authenticated;
grant execute on function anttodo_private.can_edit_task_list(uuid, text) to authenticated;

alter table public.task_list_preferences enable row level security;
alter table public.task_sections enable row level security;
alter table public.task_list_placements enable row level security;

create policy task_list_preferences_select
on public.task_list_preferences for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.can_view_task_list(workspace_id, list_key))
);

create policy task_list_preferences_insert
on public.task_list_preferences for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.can_view_task_list(workspace_id, list_key))
);

create policy task_list_preferences_update
on public.task_list_preferences for update to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.can_view_task_list(workspace_id, list_key))
)
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.can_view_task_list(workspace_id, list_key))
);

create policy task_sections_select
on public.task_sections for select to authenticated
using ((select anttodo_private.can_view_task_list(workspace_id, list_key)));

create policy task_sections_insert
on public.task_sections for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.can_edit_task_list(workspace_id, list_key))
);

create policy task_sections_update
on public.task_sections for update to authenticated
using ((select anttodo_private.can_edit_task_list(workspace_id, list_key)))
with check ((select anttodo_private.can_edit_task_list(workspace_id, list_key)));

create policy task_sections_delete
on public.task_sections for delete to authenticated
using ((select anttodo_private.can_edit_task_list(workspace_id, list_key)));

create policy task_list_placements_select
on public.task_list_placements for select to authenticated
using (
  (select anttodo_private.can_view_task_list(workspace_id, list_key))
  and (select anttodo_private.can_view_task(task_id))
);

create policy task_list_placements_insert
on public.task_list_placements for insert to authenticated
with check (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_edit_task(task_id))
  and exists (
    select 1 from public.tasks t
    where t.id = task_id and t.workspace_id = workspace_id
  )
  and (
    section_id is null
    or exists (
      select 1 from public.task_sections s
      where s.id = section_id
        and s.workspace_id = workspace_id
        and s.list_key = task_list_placements.list_key
    )
  )
);

create policy task_list_placements_update
on public.task_list_placements for update to authenticated
using (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_edit_task(task_id))
)
with check (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_edit_task(task_id))
  and exists (
    select 1 from public.tasks t
    where t.id = task_id and t.workspace_id = workspace_id
  )
  and (
    section_id is null
    or exists (
      select 1 from public.task_sections s
      where s.id = section_id
        and s.workspace_id = workspace_id
        and s.list_key = task_list_placements.list_key
    )
  )
);

create policy task_list_placements_delete
on public.task_list_placements for delete to authenticated
using (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_edit_task(task_id))
);

create or replace function public.set_task_list_order(
  p_workspace_id uuid,
  p_list_key text,
  p_section_id uuid,
  p_task_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_task_id uuid;
  ordinal integer := 0;
begin
  if not anttodo_private.can_edit_task_list(p_workspace_id, p_list_key) then
    raise exception 'Insufficient list permission';
  end if;

  if p_section_id is not null and not exists (
    select 1 from public.task_sections s
    where s.id = p_section_id
      and s.workspace_id = p_workspace_id
      and s.list_key = p_list_key
  ) then
    raise exception 'Invalid task section';
  end if;

  foreach current_task_id in array coalesce(p_task_ids, array[]::uuid[]) loop
    if not exists (
      select 1 from public.tasks t
      where t.id = current_task_id and t.workspace_id = p_workspace_id
    ) or not anttodo_private.can_edit_task(current_task_id) then
      raise exception 'Insufficient task permission';
    end if;

    insert into public.task_list_placements (
      workspace_id, list_key, task_id, section_id, position
    ) values (
      p_workspace_id, p_list_key, current_task_id, p_section_id, ordinal
    )
    on conflict (workspace_id, list_key, task_id)
    do update set section_id = excluded.section_id, position = excluded.position;

    ordinal := ordinal + 1;
  end loop;
end;
$$;

revoke all on function public.set_task_list_order(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.set_task_list_order(uuid, text, uuid, uuid[]) to authenticated;

grant select, insert, update on public.task_list_preferences to authenticated;
grant select, insert, update, delete on public.task_sections to authenticated;
grant select, insert, update, delete on public.task_list_placements to authenticated;
grant all on public.task_list_preferences, public.task_sections, public.task_list_placements
  to service_role;
