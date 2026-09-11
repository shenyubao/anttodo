create or replace function public.load_okr_set(
  p_workspace_id uuid,
  p_cycle_id uuid,
  p_owner_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(s) || jsonb_build_object(
    'user_acl_ids', coalesce((
      select jsonb_agg(a.user_id order by a.user_id)
      from public.okr_set_user_acl a
      where a.set_id = s.id
    ), '[]'::jsonb),
    'group_acl_ids', coalesce((
      select jsonb_agg(a.group_id order by a.group_id)
      from public.okr_set_group_acl a
      where a.set_id = s.id
    ), '[]'::jsonb),
    'objectives', coalesce((
      select jsonb_agg(
        to_jsonb(o) || jsonb_build_object(
          'responsible_ids', coalesce((
            select jsonb_agg(r.user_id order by r.position, r.user_id)
            from public.okr_objective_responsibles r
            where r.objective_id = o.id
          ), '[]'::jsonb),
          'user_acl_ids', coalesce((
            select jsonb_agg(a.user_id order by a.user_id)
            from public.okr_objective_user_acl a
            where a.objective_id = o.id
          ), '[]'::jsonb),
          'group_acl_ids', coalesce((
            select jsonb_agg(a.group_id order by a.group_id)
            from public.okr_objective_group_acl a
            where a.objective_id = o.id
          ), '[]'::jsonb),
          'alignment_target_id', (
            select a.target_objective_id
            from public.okr_objective_alignments a
            where a.source_objective_id = o.id
          ),
          'key_results', coalesce((
            select jsonb_agg(
              to_jsonb(kr) || jsonb_build_object(
                'responsible_ids', coalesce((
                  select jsonb_agg(r.user_id order by r.position, r.user_id)
                  from public.okr_key_result_responsibles r
                  where r.key_result_id = kr.id
                ), '[]'::jsonb),
                'user_acl_ids', coalesce((
                  select jsonb_agg(a.user_id order by a.user_id)
                  from public.okr_key_result_user_acl a
                  where a.key_result_id = kr.id
                ), '[]'::jsonb),
                'group_acl_ids', coalesce((
                  select jsonb_agg(a.group_id order by a.group_id)
                  from public.okr_key_result_group_acl a
                  where a.key_result_id = kr.id
                ), '[]'::jsonb),
                'breakdowns', coalesce((
                  select jsonb_agg(to_jsonb(b) order by b.position, b.id)
                  from public.okr_kr_breakdowns b
                  where b.key_result_id = kr.id
                ), '[]'::jsonb)
              ) order by kr.position, kr.id
            )
            from public.okr_key_results kr
            where kr.objective_id = o.id
          ), '[]'::jsonb)
        ) order by o.position, o.id
      )
      from public.okr_objectives o
      where o.set_id = s.id
    ), '[]'::jsonb)
  )
  from public.okr_sets s
  where s.workspace_id = p_workspace_id
    and s.cycle_id = p_cycle_id
    and s.owner_id = p_owner_id
  limit 1
$$;

revoke all on function public.load_okr_set(uuid, uuid, uuid) from public, anon;
grant execute on function public.load_okr_set(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.create_okr_key_result_with_balanced_weights(
  p_objective_id uuid,
  p_workspace_id uuid,
  p_title text,
  p_position integer,
  p_existing_ids uuid[],
  p_existing_weights numeric[],
  p_new_weight numeric
)
returns public.okr_key_results
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_key_result public.okr_key_results;
  updated_count integer;
begin
  if coalesce(cardinality(p_existing_ids), 0) <> coalesce(cardinality(p_existing_weights), 0) then
    raise exception 'Existing Key Result ids and weights must have the same length';
  end if;

  update public.okr_key_results kr
  set weight = balanced.weight,
      updated_at = now()
  from unnest(p_existing_ids, p_existing_weights) as balanced(id, weight)
  where kr.id = balanced.id
    and kr.objective_id = p_objective_id
    and kr.workspace_id = p_workspace_id;

  get diagnostics updated_count = row_count;
  if updated_count <> coalesce(cardinality(p_existing_ids), 0) then
    raise exception 'One or more Key Results are unavailable for rebalancing';
  end if;

  insert into public.okr_key_results(
    objective_id,
    workspace_id,
    title,
    position,
    weight
  ) values (
    p_objective_id,
    p_workspace_id,
    p_title,
    p_position,
    p_new_weight
  )
  returning * into created_key_result;

  return created_key_result;
end;
$$;

revoke all on function public.create_okr_key_result_with_balanced_weights(
  uuid, uuid, text, integer, uuid[], numeric[], numeric
) from public, anon;
grant execute on function public.create_okr_key_result_with_balanced_weights(
  uuid, uuid, text, integer, uuid[], numeric[], numeric
) to authenticated, service_role;
