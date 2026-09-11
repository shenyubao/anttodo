begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_id_workspace_id_key'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_id_workspace_id_key unique (id, workspace_id);
  end if;
end $$;

create table public.task_okr_links (
  task_id uuid primary key,
  key_result_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, workspace_id)
    references public.tasks(id, workspace_id) on delete cascade,
  foreign key (key_result_id, workspace_id)
    references public.okr_key_results(id, workspace_id) on delete cascade
);

create index task_okr_links_key_result_idx
  on public.task_okr_links(key_result_id, updated_at desc);
create index task_okr_links_workspace_idx
  on public.task_okr_links(workspace_id);

alter table public.task_okr_links enable row level security;

revoke all on table public.task_okr_links from public, anon, authenticated;
grant select on table public.task_okr_links to authenticated;

create policy task_okr_links_select
on public.task_okr_links
for select
to authenticated
using (
  (select anttodo_private.can_view_task(task_id))
  and (select anttodo_private.can_view_okr_key_result(key_result_id))
);

create or replace function public.set_task_okr_link(
  p_task_id uuid,
  p_key_result_id uuid
)
returns public.task_okr_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  task_row public.tasks;
  key_result_workspace uuid;
  result public.task_okr_links;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into task_row
  from public.tasks
  where id = p_task_id;

  if not found or not anttodo_private.can_organize_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode = '42501';
  end if;

  if task_row.kind <> 'todo' or task_row.deleted_at is not null then
    raise exception 'Only active todos can be linked to OKR' using errcode = '22023';
  end if;

  if p_key_result_id is null then
    delete from public.task_okr_links
    where task_id = p_task_id;
    -- Do not return the removed row: a historical KR may no longer be visible
    -- to the caller even though they still have permission to manage the task.
    return null;
  end if;

  select kr.workspace_id into key_result_workspace
  from public.okr_key_results kr
  join public.okr_objectives objective on objective.id = kr.objective_id
  join public.okr_sets okr_set on okr_set.id = objective.set_id
  join public.okr_cycles cycle on cycle.id = okr_set.cycle_id
  where kr.id = p_key_result_id
    and okr_set.owner_id = caller_id
    and cycle.status = 'active';

  if not found then
    raise exception 'Key Result must belong to the caller in an active cycle'
      using errcode = '42501';
  end if;

  if key_result_workspace <> task_row.workspace_id then
    raise exception 'Task and Key Result must belong to the same workspace'
      using errcode = '22023';
  end if;

  insert into public.task_okr_links (
    task_id,
    key_result_id,
    workspace_id,
    created_by,
    created_at,
    updated_at
  ) values (
    p_task_id,
    p_key_result_id,
    task_row.workspace_id,
    caller_id,
    now(),
    now()
  )
  on conflict (task_id) do update
  set key_result_id = excluded.key_result_id,
      workspace_id = excluded.workspace_id,
      created_by = excluded.created_by,
      updated_at = excluded.updated_at
  returning * into result;

  return result;
end;
$$;

revoke all on function public.set_task_okr_link(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_task_okr_link(uuid, uuid)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_okr_links'
    ) then
    alter publication supabase_realtime add table public.task_okr_links;
  end if;
end $$;

commit;
