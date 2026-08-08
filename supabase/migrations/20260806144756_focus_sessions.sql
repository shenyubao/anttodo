create type public.focus_session_mode as enum ('pomodoro', 'stopwatch');
create type public.focus_session_kind as enum ('focus', 'short_break', 'long_break');

create table public.focus_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  mode public.focus_session_mode not null default 'pomodoro',
  kind public.focus_session_kind not null default 'focus',
  planned_seconds integer not null check (planned_seconds >= 0),
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  notes text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);

create index focus_sessions_user_workspace_started_idx
  on public.focus_sessions (user_id, workspace_id, started_at desc);

create table public.user_focus_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pomodoro_minutes integer not null default 25
    check (pomodoro_minutes between 1 and 180),
  short_break_minutes integer not null default 5
    check (short_break_minutes between 1 and 60),
  long_break_minutes integer not null default 15
    check (long_break_minutes between 1 and 120),
  long_break_interval integer not null default 4
    check (long_break_interval between 1 and 12),
  auto_start_pomodoro boolean not null default false,
  auto_start_break boolean not null default false,
  show_tab_title boolean not null default true,
  sound_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

create trigger user_focus_settings_updated_at
before update on public.user_focus_settings
for each row execute function anttodo_private.set_updated_at();

create or replace function anttodo_private.validate_focus_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  task_workspace_id uuid;
begin
  if new.user_id is distinct from (select auth.uid()) then
    raise exception 'Focus session must belong to the current user'
      using errcode = '42501';
  end if;

  if not anttodo_private.is_workspace_member(new.workspace_id) then
    raise exception 'Focus session requires workspace membership'
      using errcode = '42501';
  end if;

  if new.task_id is not null then
    select t.workspace_id
    into task_workspace_id
    from public.tasks t
    where t.id = new.task_id;

    if task_workspace_id is null then
      raise exception 'Focus session task does not exist'
        using errcode = '23503';
    end if;

    if task_workspace_id is distinct from new.workspace_id then
      raise exception 'Focus session task must belong to the same workspace'
        using errcode = '23514';
    end if;

    if not anttodo_private.can_view_task(new.task_id) then
      raise exception 'Focus session task is not visible to the current user'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger focus_sessions_validate
before insert or update on public.focus_sessions
for each row execute function anttodo_private.validate_focus_session();

alter table public.focus_sessions enable row level security;
alter table public.user_focus_settings enable row level security;

create policy focus_sessions_select_self
on public.focus_sessions for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy focus_sessions_insert_self
on public.focus_sessions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy focus_sessions_update_self
on public.focus_sessions for update to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy focus_sessions_delete_self
on public.focus_sessions for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy user_focus_settings_select_self
on public.user_focus_settings for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy user_focus_settings_insert_self
on public.user_focus_settings for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy user_focus_settings_update_self
on public.user_focus_settings for update to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

grant select, insert, update, delete on public.focus_sessions to authenticated;
grant select, insert, update on public.user_focus_settings to authenticated;
