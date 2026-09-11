create or replace function anttodo_private.is_valid_task_matrix_definition(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(value) = 'object'
    and value ?& array['labels', 'due', 'priorities', 'kinds']
    and value - array['labels', 'due', 'priorities', 'kinds'] = '{}'::jsonb
    and (
      value -> 'labels' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'labels') = 'array'
        and jsonb_array_length(value -> 'labels') > 0
        and not exists (
          select 1 from jsonb_array_elements(value -> 'labels') item
          where jsonb_typeof(item) <> 'string' or item #>> '{}' = ''
        )
      )
    )
    and (
      value -> 'due' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'due') = 'array'
        and jsonb_array_length(value -> 'due') > 0
        and not exists (
          select 1 from jsonb_array_elements_text(value -> 'due') item
          where item not in ('overdue', 'today', 'tomorrow', 'later', 'none')
        )
      )
    )
    and (
      value -> 'priorities' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'priorities') = 'array'
        and jsonb_array_length(value -> 'priorities') > 0
        and not exists (
          select 1 from jsonb_array_elements_text(value -> 'priorities') item
          where item not in ('high', 'medium', 'low', 'none')
        )
      )
    )
    and (
      value -> 'kinds' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'kinds') = 'array'
        and jsonb_array_length(value -> 'kinds') > 0
        and not exists (
          select 1 from jsonb_array_elements_text(value -> 'kinds') item
          where item not in ('todo', 'note')
        )
      )
    );
$$;

revoke all on function anttodo_private.is_valid_task_matrix_definition(jsonb) from public;
grant execute on function anttodo_private.is_valid_task_matrix_definition(jsonb) to authenticated;

create table public.task_matrix_quadrants (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quadrant_key text not null check (quadrant_key in (
    'important_urgent',
    'important_not_urgent',
    'not_important_urgent',
    'not_important_not_urgent'
  )),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  definition jsonb not null check (anttodo_private.is_valid_task_matrix_definition(definition)),
  grouping text not null default 'due' check (grouping in ('due', 'label', 'priority', 'none')),
  sort text not null default 'due' check (sort in ('due', 'title', 'priority', 'created')),
  direction public.sort_direction not null default 'asc',
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id, quadrant_key)
);

create index task_matrix_quadrants_workspace_user_idx
  on public.task_matrix_quadrants(workspace_id, user_id);

create trigger task_matrix_quadrants_updated_at
before update on public.task_matrix_quadrants
for each row execute function anttodo_private.set_updated_at();

alter table public.task_matrix_quadrants enable row level security;

create policy task_matrix_quadrants_select
on public.task_matrix_quadrants for select to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy task_matrix_quadrants_insert
on public.task_matrix_quadrants for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy task_matrix_quadrants_update
on public.task_matrix_quadrants for update to authenticated
using (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

grant select, insert, update on public.task_matrix_quadrants to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_matrix_quadrants'
    )
  then
    alter publication supabase_realtime add table public.task_matrix_quadrants;
  end if;
end;
$$;
