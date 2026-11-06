-- KR responsibility grants contribution rights, not structural editing rights.
create or replace function anttodo_private.can_contribute_okr_key_result(target_key_result uuid)
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
    join public.okr_cycles c on c.id = s.cycle_id
    where kr.id = target_key_result
      and c.status = 'active'
      and anttodo_private.is_workspace_member(kr.workspace_id)
      and anttodo_private.can_view_okr_key_result(kr.id)
      and (
        s.owner_id = (select auth.uid())
        or exists (
          select 1 from public.okr_key_result_responsibles r
          where r.key_result_id = kr.id and r.user_id = (select auth.uid())
        )
      )
  );
$$;
revoke all on function anttodo_private.can_contribute_okr_key_result(uuid) from public, anon;
grant execute on function anttodo_private.can_contribute_okr_key_result(uuid) to authenticated;

-- RLS controls which rows may be updated; this guard restricts the columns
-- for contributors. Owners retain the existing structural editing rules.
create or replace function anttodo_private.guard_okr_contributor_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
    or anttodo_private.is_okr_key_result_owner(old.id) then
    return new;
  end if;
  if (to_jsonb(new) - array['current_value', 'progress_status', 'updated_at'])
    is distinct from (to_jsonb(old) - array['current_value', 'progress_status', 'updated_at']) then
    raise exception 'KR responsibles may only update progress' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function anttodo_private.guard_okr_contributor_update() from public, anon, authenticated;
create trigger guard_okr_contributor_update
before update on public.okr_key_results
for each row execute function anttodo_private.guard_okr_contributor_update();

alter policy okr_key_results_update on public.okr_key_results
using ((select anttodo_private.can_contribute_okr_key_result(id)))
with check (
  (select anttodo_private.owns_okr_objective(objective_id))
  or (select anttodo_private.can_contribute_okr_key_result(id))
);

alter policy okr_progress_records_insert on public.okr_progress_records
with check (
  actor_id = (select auth.uid())
  and (
    (objective_id is not null and (select anttodo_private.owns_okr_objective(objective_id)))
    or (key_result_id is not null and (select anttodo_private.can_contribute_okr_key_result(key_result_id)))
  )
);

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
  if not anttodo_private.can_contribute_okr_key_result(p_key_result_id) then
    raise exception 'Only the OKR owner or assigned KR responsible can update progress' using errcode = '42501';
  end if;
  select * into previous from public.okr_key_results where id = p_key_result_id for update;
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
  where kr.id = p_key_result_id
    and anttodo_private.can_contribute_okr_key_result(kr.id);

  if not found then
    raise exception 'Key Result must be owned by or assigned to the caller in an active cycle'
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
