create type public.okr_cycle_status as enum ('draft', 'active', 'closed');
create type public.okr_visibility as enum ('inherit', 'workspace', 'restricted');
create type public.okr_progress_status as enum ('none', 'normal', 'risk', 'delayed');
create type public.okr_progress_mode as enum ('manual', 'key_results');
create type public.okr_status_mode as enum ('manual', 'automatic');
create type public.okr_metric_unit as enum ('percent', 'cny', 'usd', 'none', 'custom');

create table public.okr_cycles (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  starts_on date not null,
  ends_on date not null,
  status public.okr_cycle_status not null default 'draft',
  position integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on <= ends_on),
  unique (workspace_id, name),
  unique (id, workspace_id)
);

create table public.okr_sets (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid not null references public.okr_cycles(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility public.okr_visibility not null default 'workspace' check (visibility <> 'inherit'),
  published_version integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, owner_id),
  unique (id, workspace_id),
  foreign key (workspace_id, owner_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.okr_set_user_acl (
  set_id uuid not null references public.okr_sets(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (set_id, user_id),
  foreign key (set_id, workspace_id) references public.okr_sets(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.okr_set_group_acl (
  set_id uuid not null references public.okr_sets(id) on delete cascade,
  workspace_id uuid not null,
  group_id uuid not null references public.user_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (set_id, group_id),
  foreign key (set_id, workspace_id) references public.okr_sets(id, workspace_id) on delete cascade
);

create table public.okr_objectives (
  id uuid primary key default extensions.gen_random_uuid(),
  set_id uuid not null references public.okr_sets(id) on delete cascade,
  workspace_id uuid not null,
  title text not null check (char_length(title) between 1 and 500),
  note text not null default '',
  position integer not null default 0,
  visibility public.okr_visibility not null default 'inherit',
  progress_mode public.okr_progress_mode not null default 'manual',
  status_mode public.okr_status_mode not null default 'manual',
  progress_status public.okr_progress_status not null default 'none',
  start_value numeric not null default 0,
  target_value numeric not null default 100,
  current_value numeric,
  metric_unit public.okr_metric_unit not null default 'percent',
  custom_unit text,
  score numeric(2,1) check (score is null or (score >= 0 and score <= 1)),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (set_id, workspace_id) references public.okr_sets(id, workspace_id) on delete cascade,
  unique (id, workspace_id),
  check (target_value <> start_value),
  check (metric_unit <> 'custom' or nullif(btrim(custom_unit), '') is not null)
);

create table public.okr_objective_user_acl (
  objective_id uuid not null references public.okr_objectives(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (objective_id, user_id),
  foreign key (objective_id, workspace_id)
    references public.okr_objectives(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.okr_objective_group_acl (
  objective_id uuid not null references public.okr_objectives(id) on delete cascade,
  workspace_id uuid not null,
  group_id uuid not null references public.user_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (objective_id, group_id),
  foreign key (objective_id, workspace_id)
    references public.okr_objectives(id, workspace_id) on delete cascade,
  foreign key (group_id, workspace_id)
    references public.user_groups(id, workspace_id) on delete cascade
);

create table public.okr_key_results (
  id uuid primary key default extensions.gen_random_uuid(),
  objective_id uuid not null references public.okr_objectives(id) on delete cascade,
  workspace_id uuid not null,
  title text not null check (char_length(title) between 1 and 500),
  position integer not null default 0,
  visibility public.okr_visibility not null default 'inherit',
  status_mode public.okr_status_mode not null default 'manual',
  progress_status public.okr_progress_status not null default 'none',
  start_value numeric not null default 0,
  target_value numeric not null default 100,
  current_value numeric,
  metric_unit public.okr_metric_unit not null default 'percent',
  custom_unit text,
  weight numeric(5,2) not null default 100 check (weight >= 0 and weight <= 100),
  score numeric(2,1) check (score is null or (score >= 0 and score <= 1)),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (objective_id, workspace_id)
    references public.okr_objectives(id, workspace_id) on delete cascade,
  unique (id, workspace_id),
  check (target_value <> start_value),
  check (metric_unit <> 'custom' or nullif(btrim(custom_unit), '') is not null)
);

create table public.okr_key_result_user_acl (
  key_result_id uuid not null references public.okr_key_results(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (key_result_id, user_id),
  foreign key (key_result_id, workspace_id)
    references public.okr_key_results(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.okr_key_result_group_acl (
  key_result_id uuid not null references public.okr_key_results(id) on delete cascade,
  workspace_id uuid not null,
  group_id uuid not null references public.user_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (key_result_id, group_id),
  foreign key (key_result_id, workspace_id)
    references public.okr_key_results(id, workspace_id) on delete cascade,
  foreign key (group_id, workspace_id)
    references public.user_groups(id, workspace_id) on delete cascade
);

create table public.okr_objective_responsibles (
  objective_id uuid not null references public.okr_objectives(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null default 0,
  primary key (objective_id, user_id),
  foreign key (objective_id, workspace_id)
    references public.okr_objectives(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.okr_key_result_responsibles (
  key_result_id uuid not null references public.okr_key_results(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null default 0,
  primary key (key_result_id, user_id),
  foreign key (key_result_id, workspace_id)
    references public.okr_key_results(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.okr_objective_alignments (
  source_objective_id uuid primary key references public.okr_objectives(id) on delete cascade,
  target_objective_id uuid not null references public.okr_objectives(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (source_objective_id, workspace_id)
    references public.okr_objectives(id, workspace_id) on delete cascade,
  foreign key (target_objective_id, workspace_id)
    references public.okr_objectives(id, workspace_id) on delete cascade,
  check (source_objective_id <> target_objective_id)
);

create table public.okr_kr_breakdowns (
  id uuid primary key default extensions.gen_random_uuid(),
  key_result_id uuid not null references public.okr_key_results(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  allocated_value numeric not null check (allocated_value >= 0),
  position integer not null default 0,
  foreign key (key_result_id, workspace_id)
    references public.okr_key_results(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.okr_progress_records (
  id uuid primary key default extensions.gen_random_uuid(),
  objective_id uuid references public.okr_objectives(id) on delete cascade,
  key_result_id uuid references public.okr_key_results(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  previous_value numeric,
  current_value numeric,
  previous_status public.okr_progress_status,
  current_status public.okr_progress_status not null,
  detail text not null default '' check (char_length(detail) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (objective_id, workspace_id)
    references public.okr_objectives(id, workspace_id) on delete cascade,
  foreign key (key_result_id, workspace_id)
    references public.okr_key_results(id, workspace_id) on delete cascade,
  check ((objective_id is not null)::integer + (key_result_id is not null)::integer = 1)
);

create table public.okr_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  set_id uuid not null references public.okr_sets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique (set_id, version),
  foreign key (set_id, workspace_id)
    references public.okr_sets(id, workspace_id) on delete cascade
);

create table public.okr_display_preferences (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid references public.okr_cycles(id) on delete cascade,
  show_progress boolean not null default true,
  show_score boolean not null default true,
  show_weight boolean not null default true,
  apply_all_cycles boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, workspace_id)
    references public.okr_cycles(id, workspace_id) on delete cascade,
  check ((apply_all_cycles and cycle_id is null) or (not apply_all_cycles and cycle_id is not null))
);

create table public.okr_access_revisions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, cycle_id),
  foreign key (cycle_id, workspace_id)
    references public.okr_cycles(id, workspace_id) on delete cascade
);

create unique index okr_display_preferences_all_cycles
  on public.okr_display_preferences(user_id, workspace_id)
  where apply_all_cycles;
create unique index okr_display_preferences_cycle
  on public.okr_display_preferences(user_id, workspace_id, cycle_id)
  where not apply_all_cycles;

create index okr_cycles_workspace_position_idx on public.okr_cycles(workspace_id, position, starts_on desc);
create index okr_sets_workspace_cycle_idx on public.okr_sets(workspace_id, cycle_id, owner_id);
create index okr_objectives_set_position_idx on public.okr_objectives(set_id, position);
create index okr_key_results_objective_position_idx on public.okr_key_results(objective_id, position);
create index okr_progress_records_objective_idx on public.okr_progress_records(objective_id, created_at desc);
create index okr_progress_records_key_result_idx on public.okr_progress_records(key_result_id, created_at desc);

create or replace function anttodo_private.okr_cycle_is_writable(target_cycle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.okr_cycles c
    where c.id = target_cycle
      and c.status = 'active'
      and anttodo_private.is_workspace_member(c.workspace_id)
  );
$$;

create or replace function anttodo_private.is_okr_set_owner(target_set uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.okr_sets s
    where s.id = target_set and s.owner_id = (select auth.uid())
  );
$$;

create or replace function anttodo_private.is_okr_objective_owner(target_objective uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.okr_objectives o
    join public.okr_sets s on s.id = o.set_id
    where o.id = target_objective and s.owner_id = (select auth.uid())
  );
$$;

create or replace function anttodo_private.is_okr_key_result_owner(target_key_result uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.okr_key_results kr
    join public.okr_objectives o on o.id = kr.objective_id
    join public.okr_sets s on s.id = o.set_id
    where kr.id = target_key_result and s.owner_id = (select auth.uid())
  );
$$;

create or replace function anttodo_private.can_edit_okr_set(target_set uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.okr_sets s
    join public.okr_cycles c on c.id = s.cycle_id
    where s.id = target_set
      and s.owner_id = (select auth.uid())
      and c.status = 'active'
  );
$$;

create or replace function anttodo_private.okr_set_scope_allows(target_set uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_sets s
    where s.id = target_set
      and (
        s.owner_id = (select auth.uid())
        or (
          anttodo_private.is_workspace_member(s.workspace_id)
          and (
            s.visibility = 'workspace'
            or exists (
              select 1 from public.okr_set_user_acl a
              where a.set_id = s.id and a.user_id = (select auth.uid())
            )
            or exists (
              select 1
              from public.okr_set_group_acl a
              join public.user_group_members m
                on m.group_id = a.group_id and m.workspace_id = s.workspace_id
              where a.set_id = s.id and m.user_id = (select auth.uid())
            )
          )
        )
      )
  );
$$;

create or replace function anttodo_private.okr_objective_scope_allows(target_objective uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_objectives o
    join public.okr_sets s on s.id = o.set_id
    where o.id = target_objective
      and (
        s.owner_id = (select auth.uid())
        or (
          anttodo_private.is_workspace_member(o.workspace_id)
          and (
            (o.visibility = 'inherit' and anttodo_private.okr_set_scope_allows(s.id))
            or o.visibility = 'workspace'
            or (
              o.visibility = 'restricted'
              and (
                exists (
                  select 1 from public.okr_objective_user_acl a
                  where a.objective_id = o.id and a.user_id = (select auth.uid())
                )
                or exists (
                  select 1
                  from public.okr_objective_group_acl a
                  join public.user_group_members m
                    on m.group_id = a.group_id and m.workspace_id = o.workspace_id
                  where a.objective_id = o.id and m.user_id = (select auth.uid())
                )
              )
            )
          )
        )
      )
  );
$$;

create or replace function anttodo_private.okr_key_result_scope_allows(target_key_result uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_key_results kr
    join public.okr_objectives o on o.id = kr.objective_id
    join public.okr_sets s on s.id = o.set_id
    where kr.id = target_key_result
      and (
        s.owner_id = (select auth.uid())
        or (
          anttodo_private.is_workspace_member(kr.workspace_id)
          and (
            (kr.visibility = 'inherit' and anttodo_private.okr_objective_scope_allows(o.id))
            or kr.visibility = 'workspace'
            or (
              kr.visibility = 'restricted'
              and (
                exists (
                  select 1 from public.okr_key_result_user_acl a
                  where a.key_result_id = kr.id and a.user_id = (select auth.uid())
                )
                or exists (
                  select 1
                  from public.okr_key_result_group_acl a
                  join public.user_group_members m
                    on m.group_id = a.group_id and m.workspace_id = kr.workspace_id
                  where a.key_result_id = kr.id and m.user_id = (select auth.uid())
                )
              )
            )
          )
        )
      )
  );
$$;

create or replace function anttodo_private.can_view_okr_set(target_set uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_sets s
    where s.id = target_set
      and (
        s.owner_id = (select auth.uid())
        or (
          s.published_at is not null
          and anttodo_private.is_workspace_member(s.workspace_id)
          and (
            anttodo_private.okr_set_scope_allows(s.id)
            or exists (
              select 1 from public.okr_objectives o
              where o.set_id = s.id
                and o.published_at is not null
                and anttodo_private.okr_objective_scope_allows(o.id)
            )
            or exists (
              select 1 from public.okr_key_results kr
              join public.okr_objectives o on o.id = kr.objective_id
              where o.set_id = s.id
                and kr.published_at is not null
                and anttodo_private.okr_key_result_scope_allows(kr.id)
            )
          )
        )
      )
  );
$$;

create or replace function anttodo_private.can_view_okr_objective(target_objective uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_objectives o
    join public.okr_sets s on s.id = o.set_id
    where o.id = target_objective
      and (
        s.owner_id = (select auth.uid())
        or (
          o.published_at is not null
          and (
            anttodo_private.okr_objective_scope_allows(o.id)
            or exists (
              select 1 from public.okr_key_results kr
              where kr.objective_id = o.id
                and kr.published_at is not null
                and anttodo_private.okr_key_result_scope_allows(kr.id)
            )
          )
        )
      )
  );
$$;

create or replace function anttodo_private.can_view_okr_key_result(target_key_result uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_key_results kr
    join public.okr_objectives o on o.id = kr.objective_id
    join public.okr_sets s on s.id = o.set_id
    where kr.id = target_key_result
      and (
        s.owner_id = (select auth.uid())
        or (
          kr.published_at is not null
          and anttodo_private.okr_key_result_scope_allows(kr.id)
        )
      )
  );
$$;

create or replace function anttodo_private.owns_okr_objective(target_objective uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.okr_objectives o
    join public.okr_sets s on s.id = o.set_id
    join public.okr_cycles c on c.id = s.cycle_id
    where o.id = target_objective
      and s.owner_id = (select auth.uid())
      and c.status = 'active'
  );
$$;

create or replace function anttodo_private.owns_okr_key_result(target_key_result uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.okr_key_results kr
    join public.okr_objectives o on o.id = kr.objective_id
    join public.okr_sets s on s.id = o.set_id
    join public.okr_cycles c on c.id = s.cycle_id
    where kr.id = target_key_result
      and s.owner_id = (select auth.uid())
      and c.status = 'active'
  );
$$;

create or replace function anttodo_private.validate_okr_cycle_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.okr_cycles c
    where c.id = new.cycle_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'OKR cycle must belong to the same workspace';
  end if;
  return new;
end;
$$;

create trigger validate_okr_set_cycle_workspace
before insert or update on public.okr_sets
for each row execute function anttodo_private.validate_okr_cycle_workspace();

create or replace function anttodo_private.touch_okr_access_revision(
  target_workspace uuid,
  target_cycle uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.okr_access_revisions(workspace_id, cycle_id, updated_at)
  values (target_workspace, target_cycle, now())
  on conflict (workspace_id, cycle_id)
  do update set updated_at = excluded.updated_at;
$$;

create or replace function anttodo_private.touch_okr_set_access_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_set uuid;
  target_workspace uuid;
  target_cycle uuid;
begin
  if tg_table_name = 'okr_sets' then
    target_workspace := new.workspace_id;
    target_cycle := new.cycle_id;
  else
    target_set := coalesce(new.set_id, old.set_id);
    select s.workspace_id, s.cycle_id into target_workspace, target_cycle
    from public.okr_sets s where s.id = target_set;
  end if;
  if target_workspace is not null and target_cycle is not null then
    perform anttodo_private.touch_okr_access_revision(target_workspace, target_cycle);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function anttodo_private.touch_okr_objective_access_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_objective uuid;
  target_workspace uuid;
  target_cycle uuid;
begin
  if tg_table_name = 'okr_objectives' then
    target_objective := new.id;
  else
    target_objective := coalesce(new.objective_id, old.objective_id);
  end if;
  select s.workspace_id, s.cycle_id into target_workspace, target_cycle
  from public.okr_objectives o
  join public.okr_sets s on s.id = o.set_id
  where o.id = target_objective;
  if target_workspace is not null and target_cycle is not null then
    perform anttodo_private.touch_okr_access_revision(target_workspace, target_cycle);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function anttodo_private.touch_okr_key_result_access_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_key_result uuid;
  target_workspace uuid;
  target_cycle uuid;
begin
  if tg_table_name = 'okr_key_results' then
    target_key_result := new.id;
  else
    target_key_result := coalesce(new.key_result_id, old.key_result_id);
  end if;
  select s.workspace_id, s.cycle_id into target_workspace, target_cycle
  from public.okr_key_results kr
  join public.okr_objectives o on o.id = kr.objective_id
  join public.okr_sets s on s.id = o.set_id
  where kr.id = target_key_result;
  if target_workspace is not null and target_cycle is not null then
    perform anttodo_private.touch_okr_access_revision(target_workspace, target_cycle);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger okr_sets_touch_access_revision
after update of visibility on public.okr_sets
for each row execute function anttodo_private.touch_okr_set_access_revision();
create trigger okr_set_user_acl_touch_access_revision
after insert or delete on public.okr_set_user_acl
for each row execute function anttodo_private.touch_okr_set_access_revision();
create trigger okr_set_group_acl_touch_access_revision
after insert or delete on public.okr_set_group_acl
for each row execute function anttodo_private.touch_okr_set_access_revision();
create trigger okr_objectives_touch_access_revision
after update of visibility on public.okr_objectives
for each row execute function anttodo_private.touch_okr_objective_access_revision();
create trigger okr_objective_user_acl_touch_access_revision
after insert or delete on public.okr_objective_user_acl
for each row execute function anttodo_private.touch_okr_objective_access_revision();
create trigger okr_objective_group_acl_touch_access_revision
after insert or delete on public.okr_objective_group_acl
for each row execute function anttodo_private.touch_okr_objective_access_revision();
create trigger okr_key_results_touch_access_revision
after update of visibility on public.okr_key_results
for each row execute function anttodo_private.touch_okr_key_result_access_revision();
create trigger okr_key_result_user_acl_touch_access_revision
after insert or delete on public.okr_key_result_user_acl
for each row execute function anttodo_private.touch_okr_key_result_access_revision();
create trigger okr_key_result_group_acl_touch_access_revision
after insert or delete on public.okr_key_result_group_acl
for each row execute function anttodo_private.touch_okr_key_result_access_revision();

create or replace function anttodo_private.snapshot_okr_set(target_set uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'setId', s.id,
    'cycleId', s.cycle_id,
    'ownerId', s.owner_id,
    'visibility', s.visibility,
    'userAclIds', coalesce((
      select jsonb_agg(a.user_id order by a.user_id)
      from public.okr_set_user_acl a where a.set_id = s.id
    ), '[]'::jsonb),
    'groupAclIds', coalesce((
      select jsonb_agg(a.group_id order by a.group_id)
      from public.okr_set_group_acl a where a.set_id = s.id
    ), '[]'::jsonb),
    'objectives', coalesce((
      select jsonb_agg(
        to_jsonb(o) || jsonb_build_object(
          'responsibleIds', coalesce((
            select jsonb_agg(r.user_id order by r.position)
            from public.okr_objective_responsibles r where r.objective_id = o.id
          ), '[]'::jsonb),
          'userAclIds', coalesce((
            select jsonb_agg(a.user_id order by a.user_id)
            from public.okr_objective_user_acl a where a.objective_id = o.id
          ), '[]'::jsonb),
          'groupAclIds', coalesce((
            select jsonb_agg(a.group_id order by a.group_id)
            from public.okr_objective_group_acl a where a.objective_id = o.id
          ), '[]'::jsonb),
          'alignmentTargetId', (
            select a.target_objective_id from public.okr_objective_alignments a
            where a.source_objective_id = o.id
          ),
          'keyResults', coalesce((
            select jsonb_agg(
              to_jsonb(kr) || jsonb_build_object(
                'responsibleIds', coalesce((
                  select jsonb_agg(r.user_id order by r.position)
                  from public.okr_key_result_responsibles r where r.key_result_id = kr.id
                ), '[]'::jsonb),
                'userAclIds', coalesce((
                  select jsonb_agg(a.user_id order by a.user_id)
                  from public.okr_key_result_user_acl a where a.key_result_id = kr.id
                ), '[]'::jsonb),
                'groupAclIds', coalesce((
                  select jsonb_agg(a.group_id order by a.group_id)
                  from public.okr_key_result_group_acl a where a.key_result_id = kr.id
                ), '[]'::jsonb),
                'breakdowns', coalesce((
                  select jsonb_agg(to_jsonb(b) order by b.position)
                  from public.okr_kr_breakdowns b where b.key_result_id = kr.id
                ), '[]'::jsonb)
              ) order by kr.position
            ) from public.okr_key_results kr where kr.objective_id = o.id
          ), '[]'::jsonb)
        ) order by o.position
      ) from public.okr_objectives o where o.set_id = s.id
    ), '[]'::jsonb)
  )
  from public.okr_sets s where s.id = target_set;
$$;

create or replace function public.publish_okr_set(p_set_id uuid)
returns public.okr_sets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_set public.okr_sets;
  next_version integer;
begin
  if not anttodo_private.can_edit_okr_set(p_set_id) then
    raise exception 'Only the OKR owner can publish an active cycle';
  end if;

  if exists (
    select 1
    from public.okr_objectives o
    join public.okr_key_results kr on kr.objective_id = o.id
    where o.set_id = p_set_id
    group by o.id
    having abs(sum(kr.weight) - 100) > 0.001
  ) then
    raise exception 'Key Result weights must add up to 100';
  end if;

  if exists (
    select 1
    from public.okr_key_results kr
    join public.okr_objectives o on o.id = kr.objective_id
    join public.okr_kr_breakdowns b on b.key_result_id = kr.id
    where o.set_id = p_set_id
    group by kr.id
    having abs(sum(b.allocated_value) - abs(kr.target_value)) > 0.000001
  ) then
    raise exception 'Key Result breakdown allocations must equal the target value';
  end if;

  update public.okr_objectives
  set published_at = coalesce(published_at, now()), updated_at = now()
  where set_id = p_set_id;

  update public.okr_key_results kr
  set published_at = coalesce(kr.published_at, now()), updated_at = now()
  where exists (
    select 1 from public.okr_objectives o
    where o.id = kr.objective_id and o.set_id = p_set_id
  );

  update public.okr_sets
  set published_version = published_version + 1,
      published_at = now(),
      updated_at = now()
  where id = p_set_id
  returning * into updated_set;

  next_version := updated_set.published_version;
  insert into public.okr_versions (
    set_id, workspace_id, version, snapshot, published_by, published_at
  ) values (
    updated_set.id,
    updated_set.workspace_id,
    next_version,
    anttodo_private.snapshot_okr_set(updated_set.id),
    (select auth.uid()),
    updated_set.published_at
  );
  return updated_set;
end;
$$;

create or replace function public.update_okr_objective_progress(
  p_objective_id uuid,
  p_current_value numeric,
  p_status public.okr_progress_status,
  p_detail text default ''
)
returns public.okr_objectives
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous public.okr_objectives;
  updated public.okr_objectives;
begin
  if not anttodo_private.owns_okr_objective(p_objective_id) then
    raise exception 'Only the OKR owner can update progress';
  end if;
  select * into previous from public.okr_objectives where id = p_objective_id;
  update public.okr_objectives
  set current_value = p_current_value, progress_status = p_status, updated_at = now()
  where id = p_objective_id returning * into updated;
  insert into public.okr_progress_records (
    objective_id, workspace_id, actor_id, previous_value, current_value,
    previous_status, current_status, detail
  ) values (
    updated.id, updated.workspace_id, (select auth.uid()), previous.current_value,
    updated.current_value, previous.progress_status, updated.progress_status,
    left(coalesce(p_detail, ''), 2000)
  );
  return updated;
end;
$$;

create or replace function public.update_okr_key_result_progress(
  p_key_result_id uuid,
  p_current_value numeric,
  p_status public.okr_progress_status,
  p_detail text default ''
)
returns public.okr_key_results
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous public.okr_key_results;
  updated public.okr_key_results;
begin
  if not anttodo_private.owns_okr_key_result(p_key_result_id) then
    raise exception 'Only the OKR owner can update progress';
  end if;
  select * into previous from public.okr_key_results where id = p_key_result_id;
  update public.okr_key_results
  set current_value = p_current_value, progress_status = p_status, updated_at = now()
  where id = p_key_result_id returning * into updated;
  insert into public.okr_progress_records (
    key_result_id, workspace_id, actor_id, previous_value, current_value,
    previous_status, current_status, detail
  ) values (
    updated.id, updated.workspace_id, (select auth.uid()), previous.current_value,
    updated.current_value, previous.progress_status, updated.progress_status,
    left(coalesce(p_detail, ''), 2000)
  );
  return updated;
end;
$$;

revoke all on all functions in schema anttodo_private from public, anon;
grant execute on function anttodo_private.okr_cycle_is_writable(uuid) to authenticated;
grant execute on function anttodo_private.is_okr_set_owner(uuid) to authenticated;
grant execute on function anttodo_private.is_okr_objective_owner(uuid) to authenticated;
grant execute on function anttodo_private.is_okr_key_result_owner(uuid) to authenticated;
grant execute on function anttodo_private.can_edit_okr_set(uuid) to authenticated;
grant execute on function anttodo_private.can_view_okr_set(uuid) to authenticated;
grant execute on function anttodo_private.can_view_okr_objective(uuid) to authenticated;
grant execute on function anttodo_private.can_view_okr_key_result(uuid) to authenticated;
grant execute on function anttodo_private.owns_okr_objective(uuid) to authenticated;
grant execute on function anttodo_private.owns_okr_key_result(uuid) to authenticated;
grant execute on function anttodo_private.snapshot_okr_set(uuid) to authenticated;

revoke all on function public.publish_okr_set(uuid) from public, anon;
grant execute on function public.publish_okr_set(uuid) to authenticated;
revoke all on function public.update_okr_objective_progress(uuid, numeric, public.okr_progress_status, text) from public, anon;
grant execute on function public.update_okr_objective_progress(uuid, numeric, public.okr_progress_status, text) to authenticated;
revoke all on function public.update_okr_key_result_progress(uuid, numeric, public.okr_progress_status, text) from public, anon;
grant execute on function public.update_okr_key_result_progress(uuid, numeric, public.okr_progress_status, text) to authenticated;

alter table public.okr_cycles enable row level security;
alter table public.okr_sets enable row level security;
alter table public.okr_set_user_acl enable row level security;
alter table public.okr_set_group_acl enable row level security;
alter table public.okr_objectives enable row level security;
alter table public.okr_objective_user_acl enable row level security;
alter table public.okr_objective_group_acl enable row level security;
alter table public.okr_key_results enable row level security;
alter table public.okr_key_result_user_acl enable row level security;
alter table public.okr_key_result_group_acl enable row level security;
alter table public.okr_objective_responsibles enable row level security;
alter table public.okr_key_result_responsibles enable row level security;
alter table public.okr_objective_alignments enable row level security;
alter table public.okr_kr_breakdowns enable row level security;
alter table public.okr_progress_records enable row level security;
alter table public.okr_versions enable row level security;
alter table public.okr_display_preferences enable row level security;
alter table public.okr_access_revisions enable row level security;

create policy okr_cycles_select on public.okr_cycles for select to authenticated
using (
  (select anttodo_private.is_workspace_member(workspace_id))
  and (status <> 'draft' or (select anttodo_private.is_workspace_admin(workspace_id)))
);
create policy okr_cycles_insert on public.okr_cycles for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.is_workspace_admin(workspace_id))
);
create policy okr_cycles_update on public.okr_cycles for update to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)))
with check ((select anttodo_private.is_workspace_admin(workspace_id)));
create policy okr_cycles_delete on public.okr_cycles for delete to authenticated
using ((select anttodo_private.is_workspace_admin(workspace_id)));

create policy okr_sets_select on public.okr_sets for select to authenticated
using ((select anttodo_private.can_view_okr_set(id)));
create policy okr_sets_insert on public.okr_sets for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (select anttodo_private.okr_cycle_is_writable(cycle_id))
);
create policy okr_sets_update on public.okr_sets for update to authenticated
using ((select anttodo_private.can_edit_okr_set(id)))
with check (owner_id = (select auth.uid()) and (select anttodo_private.okr_cycle_is_writable(cycle_id)));
create policy okr_sets_delete on public.okr_sets for delete to authenticated
using ((select anttodo_private.can_edit_okr_set(id)));

create policy okr_set_user_acl_select on public.okr_set_user_acl for select to authenticated
using ((select anttodo_private.is_okr_set_owner(set_id)));
create policy okr_set_user_acl_insert on public.okr_set_user_acl for insert to authenticated
with check ((select anttodo_private.can_edit_okr_set(set_id)));
create policy okr_set_user_acl_delete on public.okr_set_user_acl for delete to authenticated
using ((select anttodo_private.can_edit_okr_set(set_id)));
create policy okr_set_group_acl_select on public.okr_set_group_acl for select to authenticated
using ((select anttodo_private.is_okr_set_owner(set_id)));
create policy okr_set_group_acl_insert on public.okr_set_group_acl for insert to authenticated
with check ((select anttodo_private.can_edit_okr_set(set_id)));
create policy okr_set_group_acl_delete on public.okr_set_group_acl for delete to authenticated
using ((select anttodo_private.can_edit_okr_set(set_id)));

create policy okr_objectives_select on public.okr_objectives for select to authenticated
using ((select anttodo_private.can_view_okr_objective(id)));
create policy okr_objectives_insert on public.okr_objectives for insert to authenticated
with check ((select anttodo_private.can_edit_okr_set(set_id)));
create policy okr_objectives_update on public.okr_objectives for update to authenticated
using ((select anttodo_private.owns_okr_objective(id)))
with check ((select anttodo_private.can_edit_okr_set(set_id)));
create policy okr_objectives_delete on public.okr_objectives for delete to authenticated
using ((select anttodo_private.owns_okr_objective(id)));

create policy okr_key_results_select on public.okr_key_results for select to authenticated
using ((select anttodo_private.can_view_okr_key_result(id)));
create policy okr_key_results_insert on public.okr_key_results for insert to authenticated
with check ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_key_results_update on public.okr_key_results for update to authenticated
using ((select anttodo_private.owns_okr_key_result(id)))
with check ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_key_results_delete on public.okr_key_results for delete to authenticated
using ((select anttodo_private.owns_okr_key_result(id)));

create policy okr_objective_user_acl_select on public.okr_objective_user_acl for select to authenticated
using ((select anttodo_private.is_okr_objective_owner(objective_id)));
create policy okr_objective_user_acl_insert on public.okr_objective_user_acl for insert to authenticated
with check ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_objective_user_acl_delete on public.okr_objective_user_acl for delete to authenticated
using ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_objective_group_acl_select on public.okr_objective_group_acl for select to authenticated
using ((select anttodo_private.is_okr_objective_owner(objective_id)));
create policy okr_objective_group_acl_insert on public.okr_objective_group_acl for insert to authenticated
with check ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_objective_group_acl_delete on public.okr_objective_group_acl for delete to authenticated
using ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_key_result_user_acl_select on public.okr_key_result_user_acl for select to authenticated
using ((select anttodo_private.is_okr_key_result_owner(key_result_id)));
create policy okr_key_result_user_acl_insert on public.okr_key_result_user_acl for insert to authenticated
with check ((select anttodo_private.owns_okr_key_result(key_result_id)));
create policy okr_key_result_user_acl_delete on public.okr_key_result_user_acl for delete to authenticated
using ((select anttodo_private.owns_okr_key_result(key_result_id)));
create policy okr_key_result_group_acl_select on public.okr_key_result_group_acl for select to authenticated
using ((select anttodo_private.is_okr_key_result_owner(key_result_id)));
create policy okr_key_result_group_acl_insert on public.okr_key_result_group_acl for insert to authenticated
with check ((select anttodo_private.owns_okr_key_result(key_result_id)));
create policy okr_key_result_group_acl_delete on public.okr_key_result_group_acl for delete to authenticated
using ((select anttodo_private.owns_okr_key_result(key_result_id)));

create policy okr_objective_responsibles_select on public.okr_objective_responsibles for select to authenticated
using ((select anttodo_private.can_view_okr_objective(objective_id)));
create policy okr_objective_responsibles_insert on public.okr_objective_responsibles for insert to authenticated
with check ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_objective_responsibles_delete on public.okr_objective_responsibles for delete to authenticated
using ((select anttodo_private.owns_okr_objective(objective_id)));
create policy okr_key_result_responsibles_select on public.okr_key_result_responsibles for select to authenticated
using ((select anttodo_private.can_view_okr_key_result(key_result_id)));
create policy okr_key_result_responsibles_insert on public.okr_key_result_responsibles for insert to authenticated
with check ((select anttodo_private.owns_okr_key_result(key_result_id)));
create policy okr_key_result_responsibles_delete on public.okr_key_result_responsibles for delete to authenticated
using ((select anttodo_private.owns_okr_key_result(key_result_id)));

create policy okr_alignments_select on public.okr_objective_alignments for select to authenticated
using (
  (select anttodo_private.can_view_okr_objective(source_objective_id))
  and (select anttodo_private.can_view_okr_objective(target_objective_id))
);
create policy okr_alignments_insert on public.okr_objective_alignments for insert to authenticated
with check (
  (select anttodo_private.owns_okr_objective(source_objective_id))
  and (select anttodo_private.can_view_okr_objective(target_objective_id))
);
create policy okr_alignments_delete on public.okr_objective_alignments for delete to authenticated
using ((select anttodo_private.owns_okr_objective(source_objective_id)));

create policy okr_breakdowns_select on public.okr_kr_breakdowns for select to authenticated
using ((select anttodo_private.can_view_okr_key_result(key_result_id)));
create policy okr_breakdowns_insert on public.okr_kr_breakdowns for insert to authenticated
with check ((select anttodo_private.owns_okr_key_result(key_result_id)));
create policy okr_breakdowns_update on public.okr_kr_breakdowns for update to authenticated
using ((select anttodo_private.owns_okr_key_result(key_result_id)))
with check ((select anttodo_private.owns_okr_key_result(key_result_id)));
create policy okr_breakdowns_delete on public.okr_kr_breakdowns for delete to authenticated
using ((select anttodo_private.owns_okr_key_result(key_result_id)));

create policy okr_progress_records_select on public.okr_progress_records for select to authenticated
using (
  (objective_id is not null and (select anttodo_private.can_view_okr_objective(objective_id)))
  or (key_result_id is not null and (select anttodo_private.can_view_okr_key_result(key_result_id)))
);
create policy okr_progress_records_insert on public.okr_progress_records for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (
    (objective_id is not null and (select anttodo_private.owns_okr_objective(objective_id)))
    or (key_result_id is not null and (select anttodo_private.owns_okr_key_result(key_result_id)))
  )
);

create policy okr_versions_select on public.okr_versions for select to authenticated
using ((select anttodo_private.can_view_okr_set(set_id)));
create policy okr_versions_insert on public.okr_versions for insert to authenticated
with check (published_by = (select auth.uid()) and (select anttodo_private.can_edit_okr_set(set_id)));

create policy okr_display_preferences_select on public.okr_display_preferences for select to authenticated
using (user_id = (select auth.uid()));
create policy okr_display_preferences_insert on public.okr_display_preferences for insert to authenticated
with check (user_id = (select auth.uid()) and (select anttodo_private.is_workspace_member(workspace_id)));
create policy okr_display_preferences_update on public.okr_display_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and (select anttodo_private.is_workspace_member(workspace_id)));
create policy okr_display_preferences_delete on public.okr_display_preferences for delete to authenticated
using (user_id = (select auth.uid()));
create policy okr_access_revisions_select on public.okr_access_revisions for select to authenticated
using ((select anttodo_private.is_workspace_member(workspace_id)));

grant select, insert, update, delete on public.okr_cycles to authenticated;
grant select, insert, update, delete on public.okr_sets to authenticated;
grant select, insert, delete on public.okr_set_user_acl, public.okr_set_group_acl to authenticated;
grant select, insert, update, delete on public.okr_objectives, public.okr_key_results to authenticated;
grant select, insert, delete on public.okr_objective_user_acl, public.okr_objective_group_acl to authenticated;
grant select, insert, delete on public.okr_key_result_user_acl, public.okr_key_result_group_acl to authenticated;
grant select, insert, delete on public.okr_objective_responsibles, public.okr_key_result_responsibles to authenticated;
grant select, insert, delete on public.okr_objective_alignments to authenticated;
grant select, insert, update, delete on public.okr_kr_breakdowns to authenticated;
grant select, insert on public.okr_progress_records, public.okr_versions to authenticated;
grant select, insert, update, delete on public.okr_display_preferences to authenticated;
grant select on public.okr_access_revisions to authenticated;
grant all on public.okr_cycles, public.okr_sets, public.okr_set_user_acl,
  public.okr_set_group_acl, public.okr_objectives, public.okr_objective_user_acl,
  public.okr_objective_group_acl, public.okr_key_results,
  public.okr_key_result_user_acl, public.okr_key_result_group_acl,
  public.okr_objective_responsibles, public.okr_key_result_responsibles,
  public.okr_objective_alignments, public.okr_kr_breakdowns,
  public.okr_progress_records, public.okr_versions,
  public.okr_display_preferences, public.okr_access_revisions to service_role;

alter publication supabase_realtime add table public.okr_cycles;
alter publication supabase_realtime add table public.okr_sets;
alter publication supabase_realtime add table public.okr_set_user_acl;
alter publication supabase_realtime add table public.okr_set_group_acl;
alter publication supabase_realtime add table public.okr_objectives;
alter publication supabase_realtime add table public.okr_objective_user_acl;
alter publication supabase_realtime add table public.okr_objective_group_acl;
alter publication supabase_realtime add table public.okr_objective_responsibles;
alter publication supabase_realtime add table public.okr_objective_alignments;
alter publication supabase_realtime add table public.okr_key_results;
alter publication supabase_realtime add table public.okr_key_result_user_acl;
alter publication supabase_realtime add table public.okr_key_result_group_acl;
alter publication supabase_realtime add table public.okr_key_result_responsibles;
alter publication supabase_realtime add table public.okr_kr_breakdowns;
alter publication supabase_realtime add table public.okr_progress_records;
alter publication supabase_realtime add table public.okr_versions;
alter publication supabase_realtime add table public.okr_display_preferences;
alter publication supabase_realtime add table public.okr_access_revisions;
