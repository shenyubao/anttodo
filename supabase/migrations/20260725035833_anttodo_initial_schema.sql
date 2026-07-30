create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron;

create schema if not exists anttodo_private;
revoke all on schema anttodo_private from public, anon;
grant usage on schema anttodo_private to authenticated, service_role;

create type public.workspace_role as enum ('owner', 'admin', 'member');
create type public.label_visibility as enum ('workspace', 'private', 'restricted');
create type public.label_permission as enum ('view', 'edit');
create type public.task_status as enum ('open', 'completed', 'cancelled');
create type public.task_priority as enum ('none', 'low', 'medium', 'high');
create type public.connector_type as enum ('mock', 'yunxiao', 'dingtalk');
create type public.sync_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'conflict');
create type public.sync_direction as enum ('pull', 'push');
create type public.sync_conflict_status as enum ('open', 'resolved_local', 'resolved_remote');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member',
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (role <> 'owner')
);

create table public.labels (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid references public.labels(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default '#5b7cfa' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  visibility public.label_visibility not null default 'workspace',
  inherit_permissions boolean not null default true,
  is_system boolean not null default false,
  position integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, parent_id, name)
);

create table public.label_acl (
  label_id uuid not null references public.labels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission public.label_permission not null default 'view',
  created_at timestamptz not null default now(),
  primary key (label_id, user_id)
);

create table public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  description text not null default '',
  status public.task_status not null default 'open',
  priority public.task_priority not null default 'none',
  due_at timestamptz,
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  completed_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

create table public.task_labels (
  task_id uuid not null references public.tasks(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, label_id)
);

create table public.subtasks (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.connector_instances (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type public.connector_type not null,
  name text not null check (char_length(name) between 1 and 120),
  enabled boolean not null default true,
  schedule_minutes integer not null default 5 check (schedule_minutes between 1 and 1440),
  public_config jsonb not null default '{}'::jsonb,
  credential_secret_id uuid,
  credential_hint text,
  last_synced_at timestamptz,
  next_sync_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.connector_sync_state (
  connector_id uuid primary key references public.connector_instances(id) on delete cascade,
  cursor text,
  remote_watermark timestamptz,
  updated_at timestamptz not null default now()
);

create table public.external_task_links (
  id uuid primary key default extensions.gen_random_uuid(),
  connector_id uuid not null references public.connector_instances(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  external_id text not null,
  external_version text,
  remote_updated_at timestamptz,
  last_local_version integer not null default 0,
  last_synced_at timestamptz,
  unique (connector_id, external_id),
  unique (connector_id, task_id)
);

create table public.sync_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  connector_id uuid not null references public.connector_instances(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  direction public.sync_direction not null default 'push',
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table public.sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  connector_id uuid not null references public.connector_instances(id) on delete cascade,
  status public.sync_run_status not null default 'queued',
  trigger text not null default 'manual',
  pulled_count integer not null default 0,
  pushed_count integer not null default 0,
  conflict_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.sync_conflicts (
  id uuid primary key default extensions.gen_random_uuid(),
  connector_id uuid not null references public.connector_instances(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  status public.sync_conflict_status not null default 'open',
  local_snapshot jsonb not null,
  remote_snapshot jsonb not null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index workspace_members_user_idx on public.workspace_members(user_id);
create index workspace_invites_workspace_idx on public.workspace_invites(workspace_id);
create index labels_workspace_parent_idx on public.labels(workspace_id, parent_id, position);
create index label_acl_user_idx on public.label_acl(user_id, label_id);
create index tasks_workspace_status_idx on public.tasks(workspace_id, status, deleted_at);
create index tasks_due_idx on public.tasks(workspace_id, due_at) where deleted_at is null;
create index tasks_assignee_idx on public.tasks(assignee_id) where deleted_at is null;
create index task_labels_label_idx on public.task_labels(label_id, task_id);
create index subtasks_task_idx on public.subtasks(task_id, position);
create index activity_events_task_idx on public.activity_events(task_id, created_at desc);
create index connector_instances_due_idx on public.connector_instances(next_sync_at) where enabled;
create index sync_outbox_due_idx on public.sync_outbox(available_at) where processed_at is null;
create index sync_runs_connector_idx on public.sync_runs(connector_id, created_at desc);
create index sync_conflicts_connector_idx on public.sync_conflicts(connector_id, status);

create or replace function anttodo_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function anttodo_private.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces
for each row execute function anttodo_private.set_updated_at();
create trigger labels_updated_at before update on public.labels
for each row execute function anttodo_private.set_updated_at();
create trigger tasks_updated_at before update on public.tasks
for each row execute function anttodo_private.set_updated_at();
create trigger subtasks_updated_at before update on public.subtasks
for each row execute function anttodo_private.set_updated_at();
create trigger connector_instances_updated_at before update on public.connector_instances
for each row execute function anttodo_private.set_updated_at();
create trigger connector_sync_state_updated_at before update on public.connector_sync_state
for each row execute function anttodo_private.set_updated_at();

create or replace function anttodo_private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function anttodo_private.on_auth_user_created();

create or replace function anttodo_private.on_workspace_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into public.labels (
    workspace_id, name, color, visibility, inherit_permissions, is_system, position, created_by
  ) values (
    new.id, '收集箱', '#5B7CFA', 'workspace', false, true, 0, new.created_by
  );
  return new;
end;
$$;

create trigger on_workspace_created
after insert on public.workspaces
for each row execute function anttodo_private.on_workspace_created();

create or replace function anttodo_private.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = target_workspace
        and wm.user_id = (select auth.uid())
    );
$$;

create or replace function anttodo_private.is_workspace_admin(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = target_workspace
        and wm.user_id = (select auth.uid())
        and wm.role in ('owner', 'admin')
    );
$$;

create or replace function anttodo_private.shares_workspace(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      target_user = (select auth.uid())
      or exists (
        select 1
        from public.workspace_members mine
        join public.workspace_members theirs
          on theirs.workspace_id = mine.workspace_id
        where mine.user_id = (select auth.uid())
          and theirs.user_id = target_user
      )
    );
$$;

create or replace function anttodo_private.label_permission_level(target_label uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := (select auth.uid());
  current_label public.labels%rowtype;
  local_level integer;
  effective_level integer := 2;
begin
  if viewer is null then
    return 0;
  end if;

  select * into current_label from public.labels where id = target_label;
  if not found then
    return 0;
  end if;

  if exists (
    select 1 from public.workspace_members
    where workspace_id = current_label.workspace_id
      and user_id = viewer
      and role in ('owner', 'admin')
  ) then
    return 2;
  end if;

  loop
    local_level := case current_label.visibility
      when 'private' then case when current_label.created_by = viewer then 2 else 0 end
      when 'restricted' then greatest(
        case when current_label.created_by = viewer then 2 else 0 end,
        coalesce((
          select case permission when 'edit' then 2 else 1 end
          from public.label_acl
          where label_id = current_label.id and user_id = viewer
        ), 0)
      )
      else case
        when not exists (
          select 1 from public.workspace_members
          where workspace_id = current_label.workspace_id and user_id = viewer
        ) then 0
        when current_label.created_by = viewer then 2
        else greatest(
          1,
          coalesce((
            select case permission when 'edit' then 2 else 1 end
            from public.label_acl
            where label_id = current_label.id and user_id = viewer
          ), 0)
        )
      end
    end;

    effective_level := least(effective_level, local_level);
    exit when effective_level = 0
      or not current_label.inherit_permissions
      or current_label.parent_id is null;

    select * into current_label from public.labels where id = current_label.parent_id;
    exit when not found;
  end loop;

  return effective_level;
end;
$$;

create or replace function anttodo_private.can_view_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (select 1 from public.task_labels where task_id = target_task)
    and not exists (
      select 1
      from public.task_labels tl
      where tl.task_id = target_task
        and anttodo_private.label_permission_level(tl.label_id) < 1
    );
$$;

create or replace function anttodo_private.can_edit_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (select 1 from public.task_labels where task_id = target_task)
    and not exists (
      select 1
      from public.task_labels tl
      where tl.task_id = target_task
        and anttodo_private.label_permission_level(tl.label_id) < 2
    );
$$;

revoke all on all functions in schema anttodo_private from public, anon;
grant execute on function anttodo_private.is_workspace_member(uuid) to authenticated;
grant execute on function anttodo_private.is_workspace_admin(uuid) to authenticated;
grant execute on function anttodo_private.shares_workspace(uuid) to authenticated;
grant execute on function anttodo_private.label_permission_level(uuid) to authenticated;
grant execute on function anttodo_private.can_view_task(uuid) to authenticated;
grant execute on function anttodo_private.can_edit_task(uuid) to authenticated;

create or replace function public.create_task_with_labels(
  p_workspace_id uuid,
  p_title text,
  p_label_ids uuid[],
  p_description text default '',
  p_due_at timestamptz default null,
  p_priority public.task_priority default 'none',
  p_assignee_id uuid default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_task public.tasks;
  label_id uuid;
begin
  if coalesce(array_length(p_label_ids, 1), 0) = 0 then
    raise exception 'At least one label is required';
  end if;

  foreach label_id in array p_label_ids loop
    if anttodo_private.label_permission_level(label_id) < 2
      or not exists (
        select 1 from public.labels
        where id = label_id and workspace_id = p_workspace_id
      ) then
      raise exception 'Insufficient label permission';
    end if;
  end loop;

  insert into public.tasks (
    workspace_id, title, description, due_at, priority, assignee_id, created_by
  ) values (
    p_workspace_id, p_title, coalesce(p_description, ''), p_due_at, p_priority,
    p_assignee_id, (select auth.uid())
  )
  returning * into created_task;

  insert into public.task_labels (task_id, label_id)
  select created_task.id, unnest(p_label_ids);

  insert into public.activity_events (workspace_id, task_id, actor_id, event_type)
  values (p_workspace_id, created_task.id, (select auth.uid()), 'task.created');

  return created_task;
end;
$$;

revoke all on function public.create_task_with_labels(
  uuid, text, uuid[], text, timestamptz, public.task_priority, uuid
) from public, anon;
grant execute on function public.create_task_with_labels(
  uuid, text, uuid[], text, timestamptz, public.task_priority, uuid
) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.labels enable row level security;
alter table public.label_acl enable row level security;
alter table public.tasks enable row level security;
alter table public.task_labels enable row level security;
alter table public.subtasks enable row level security;
alter table public.activity_events enable row level security;
alter table public.connector_instances enable row level security;
alter table public.connector_sync_state enable row level security;
alter table public.external_task_links enable row level security;
alter table public.sync_outbox enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_conflicts enable row level security;

create policy profiles_select on public.profiles for select to authenticated
using ((select anttodo_private.shares_workspace(id)));
create policy profiles_update_self on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy workspaces_select on public.workspaces for select to authenticated
using ((select anttodo_private.is_workspace_member(id)));
create policy workspaces_insert on public.workspaces for insert to authenticated
with check ((select auth.uid()) = created_by);
create policy workspaces_update on public.workspaces for update to authenticated
using ((select anttodo_private.is_workspace_admin(id)))
with check ((select anttodo_private.is_workspace_admin(id)));

create policy workspace_members_select on public.workspace_members for select to authenticated
using ((select anttodo_private.is_workspace_member(workspace_id)));
create policy workspace_members_insert on public.workspace_members for insert to authenticated
with check ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy workspace_members_update on public.workspace_members for update to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)))
with check ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy workspace_members_delete on public.workspace_members for delete to authenticated
using (
  (select anttodo_private.is_workspace_admin(workspace_id))
  and role <> 'owner'
);

create policy workspace_invites_select on public.workspace_invites for select to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy workspace_invites_insert on public.workspace_invites for insert to authenticated
with check (
  (select anttodo_private.is_workspace_admin(workspace_id))
  and created_by = (select auth.uid())
);
create policy workspace_invites_delete on public.workspace_invites for delete to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));

create policy labels_select on public.labels for select to authenticated
using ((select anttodo_private.label_permission_level(id)) >= 1);
create policy labels_insert on public.labels for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
  and (
    parent_id is null
    or (select anttodo_private.label_permission_level(parent_id)) >= 2
  )
);
create policy labels_update on public.labels for update to authenticated
using ((select anttodo_private.label_permission_level(id)) >= 2)
with check ((select anttodo_private.label_permission_level(id)) >= 2);
create policy labels_delete on public.labels for delete to authenticated
using (
  not is_system
  and (select anttodo_private.label_permission_level(id)) >= 2
);

create policy label_acl_select on public.label_acl for select to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 1);
create policy label_acl_insert on public.label_acl for insert to authenticated
with check ((select anttodo_private.label_permission_level(label_id)) >= 2);
create policy label_acl_update on public.label_acl for update to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2)
with check ((select anttodo_private.label_permission_level(label_id)) >= 2);
create policy label_acl_delete on public.label_acl for delete to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2);

create policy tasks_select on public.tasks for select to authenticated
using ((select anttodo_private.can_view_task(id)));
create policy tasks_insert on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);
create policy tasks_update on public.tasks for update to authenticated
using ((select anttodo_private.can_edit_task(id)))
with check ((select anttodo_private.can_edit_task(id)));

create policy task_labels_select on public.task_labels for select to authenticated
using ((select anttodo_private.can_view_task(task_id)));
create policy task_labels_insert on public.task_labels for insert to authenticated
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (
    exists (
      select 1 from public.tasks
      where id = task_id and created_by = (select auth.uid())
    )
    or (select anttodo_private.can_edit_task(task_id))
  )
);
create policy task_labels_delete on public.task_labels for delete to authenticated
using ((select anttodo_private.can_edit_task(task_id)));

create policy subtasks_select on public.subtasks for select to authenticated
using ((select anttodo_private.can_view_task(task_id)));
create policy subtasks_insert on public.subtasks for insert to authenticated
with check ((select anttodo_private.can_edit_task(task_id)));
create policy subtasks_update on public.subtasks for update to authenticated
using ((select anttodo_private.can_edit_task(task_id)))
with check ((select anttodo_private.can_edit_task(task_id)));
create policy subtasks_delete on public.subtasks for delete to authenticated
using ((select anttodo_private.can_edit_task(task_id)));

create policy activity_events_select on public.activity_events for select to authenticated
using (
  (task_id is not null and (select anttodo_private.can_view_task(task_id)))
  or (task_id is null and (select anttodo_private.is_workspace_member(workspace_id)))
);
create policy activity_events_insert on public.activity_events for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (
    (task_id is not null and (select anttodo_private.can_edit_task(task_id)))
    or (task_id is null and (select anttodo_private.is_workspace_member(workspace_id)))
  )
);

create policy connectors_select on public.connector_instances for select to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy connectors_insert on public.connector_instances for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.is_workspace_admin(workspace_id))
);
create policy connectors_update on public.connector_instances for update to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)))
with check ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy connectors_delete on public.connector_instances for delete to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));

create policy connector_sync_state_all on public.connector_sync_state for all to authenticated
using (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
)
with check (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
);

create policy external_task_links_select on public.external_task_links for select to authenticated
using (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
);
create policy sync_outbox_select on public.sync_outbox for select to authenticated
using (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
);
create policy sync_runs_select on public.sync_runs for select to authenticated
using (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
);
create policy sync_conflicts_select on public.sync_conflicts for select to authenticated
using (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
);
create policy sync_conflicts_update on public.sync_conflicts for update to authenticated
using (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
)
with check (
  exists (
    select 1 from public.connector_instances c
    where c.id = connector_id
      and (select anttodo_private.is_workspace_admin(c.workspace_id))
  )
);

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, delete on public.workspace_invites to authenticated;
grant select, insert, update, delete on public.labels to authenticated;
grant select, insert, update, delete on public.label_acl to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert, delete on public.task_labels to authenticated;
grant select, insert, update, delete on public.subtasks to authenticated;
grant select, insert on public.activity_events to authenticated;
grant select, insert, update, delete on public.connector_instances to authenticated;
grant select, insert, update, delete on public.connector_sync_state to authenticated;
grant select on public.external_task_links, public.sync_outbox, public.sync_runs to authenticated;
grant select, update on public.sync_conflicts to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create or replace function anttodo_private.run_due_mock_connectors()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued_count integer;
begin
  with due as (
    update public.connector_instances
    set next_sync_at = now() + make_interval(mins => schedule_minutes)
    where enabled
      and type = 'mock'
      and next_sync_at <= now()
    returning id
  ), queued as (
    insert into public.sync_runs (
      connector_id, status, trigger, started_at, finished_at
    )
    select id, 'succeeded', 'cron', now(), now() from due
    returning id
  )
  select count(*) into queued_count from queued;

  return queued_count;
end;
$$;

revoke all on function anttodo_private.run_due_mock_connectors() from public, anon, authenticated;
grant execute on function anttodo_private.run_due_mock_connectors() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'anttodo-mock-sync') then
      perform cron.unschedule('anttodo-mock-sync');
    end if;
    perform cron.schedule(
      'anttodo-mock-sync',
      '*/5 * * * *',
      'select anttodo_private.run_due_mock_connectors()'
    );
  end if;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspaces', 'workspace_members', 'labels', 'label_acl',
    'tasks', 'task_labels', 'subtasks', 'activity_events',
    'connector_instances', 'sync_runs', 'sync_conflicts'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;
