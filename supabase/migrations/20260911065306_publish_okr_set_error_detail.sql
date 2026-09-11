create or replace function public.publish_okr_set(p_set_id uuid)
returns public.okr_sets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_set public.okr_sets;
  next_version integer;
  invalid_title text;
begin
  if not anttodo_private.can_edit_okr_set(p_set_id) then
    raise exception 'Only the OKR owner can publish an active cycle';
  end if;

  select o.title
  into invalid_title
  from public.okr_objectives o
  join public.okr_key_results kr on kr.objective_id = o.id
  where o.set_id = p_set_id
  group by o.id, o.title
  having abs(sum(kr.weight) - 100) > 0.001
  limit 1;
  if invalid_title is not null then
    raise exception 'Key Result weights must add up to 100 for objective "%"', invalid_title;
  end if;

  select kr.title
  into invalid_title
  from public.okr_key_results kr
  join public.okr_objectives o on o.id = kr.objective_id
  join public.okr_kr_breakdowns b on b.key_result_id = kr.id
  where o.set_id = p_set_id
  group by kr.id, kr.title
  having abs(sum(b.allocated_value) - abs(kr.target_value)) > 0.000001
  limit 1;
  if invalid_title is not null then
    raise exception 'Key Result breakdown allocations must equal the target value for "%"', invalid_title;
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

  if updated_set.id is null then
    raise exception 'Only the OKR owner can publish an active cycle';
  end if;

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

revoke all on function public.publish_okr_set(uuid) from public, anon;
grant execute on function public.publish_okr_set(uuid) to authenticated;
