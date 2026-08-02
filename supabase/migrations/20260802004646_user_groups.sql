create table public.user_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create unique index user_groups_workspace_name_idx
on public.user_groups (workspace_id, lower(btrim(name)));

create table public.user_group_members (
  group_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id),
  foreign key (group_id, workspace_id)
    references public.user_groups(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create index user_group_members_workspace_user_idx
on public.user_group_members (workspace_id, user_id);

create trigger user_groups_updated_at
before update on public.user_groups
for each row execute function anttodo_private.set_updated_at();

alter table public.user_groups enable row level security;
alter table public.user_group_members enable row level security;

create policy user_groups_select on public.user_groups for select to authenticated
using ((select anttodo_private.is_workspace_member(workspace_id)));
create policy user_groups_insert on public.user_groups for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.is_workspace_admin(workspace_id))
);
create policy user_groups_update on public.user_groups for update to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)))
with check ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy user_groups_delete on public.user_groups for delete to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));

create policy user_group_members_select on public.user_group_members for select to authenticated
using ((select anttodo_private.is_workspace_member(workspace_id)));
create policy user_group_members_insert on public.user_group_members for insert to authenticated
with check ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy user_group_members_delete on public.user_group_members for delete to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));

grant select, insert, update, delete on public.user_groups to authenticated;
grant select, insert, delete on public.user_group_members to authenticated;
grant all on public.user_groups, public.user_group_members to service_role;

alter publication supabase_realtime add table public.user_groups;
alter publication supabase_realtime add table public.user_group_members;
