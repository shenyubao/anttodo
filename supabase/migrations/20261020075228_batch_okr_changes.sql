-- Apply existing Objective/KR changes under the caller's RLS, in one transaction.
create function anttodo_private.apply_okr_change(
  p_kind text, p_id uuid, p_workspace_id uuid, p_change jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entity_table text;
  entity_key text;
  allowed_fields text[];
  old_row jsonb;
  fields jsonb := coalesce(p_change -> 'fields', '{}'::jsonb);
  assignments text;
  relation_name text;
  relation_table text;
  subject_key text;
  ids uuid[];
  old_breakdowns jsonb;
begin
  if p_kind not in ('objective', 'key_result') then
    raise exception 'Invalid OKR entity kind';
  end if;
  entity_table := case p_kind when 'objective' then 'okr_objectives' else 'okr_key_results' end;
  entity_key := p_kind || '_id';
  allowed_fields := array['title', 'position', 'visibility', 'status_mode', 'progress_status',
    'start_value', 'target_value', 'current_value', 'metric_unit', 'custom_unit', 'score'];
  allowed_fields := allowed_fields || case p_kind
    when 'objective' then array['note', 'progress_mode'] else array['weight'] end;
  if jsonb_typeof(fields) <> 'object' or exists (
    select 1 from jsonb_object_keys(fields) k where not (k = any(allowed_fields))
  ) then
    raise exception 'Invalid OKR fields';
  end if;
  if fields ? 'title' then
    fields := jsonb_set(fields, '{title}', coalesce(to_jsonb(btrim(fields ->> 'title')), 'null'::jsonb));
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 and workspace_id = $2 for update', entity_table)
    into old_row using p_id, p_workspace_id;
  if old_row is null then
    raise exception 'OKR entity is unavailable';
  end if;
  -- Only name columns whose value actually changes, avoiding visibility triggers on title edits.
  select string_agg(format('%I = v.%I', k, k), ', ' order by k)
    into assignments
  from jsonb_object_keys(fields) k
  where fields -> k is distinct from old_row -> k;
  if assignments is not null then
    execute format('update public.%I t set %s, updated_at = now()
      from jsonb_populate_record(null::public.%I, $1) v where t.id = $2',
      entity_table, assignments, entity_table) using fields, p_id;
  end if;

  foreach relation_name in array array['responsible_ids', 'user_acl_ids', 'group_acl_ids'] loop
    if not (p_change ? relation_name) then continue; end if;
    if jsonb_typeof(p_change -> relation_name) <> 'array' then
      raise exception 'Invalid OKR member list';
    end if;
    select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[]) into ids
      from jsonb_array_elements_text(p_change -> relation_name) with ordinality;
    if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then
      raise exception 'Duplicate OKR members';
    end if;
    relation_table := 'okr_' || p_kind || case relation_name
      when 'responsible_ids' then '_responsibles'
      when 'user_acl_ids' then '_user_acl' else '_group_acl' end;
    subject_key := case relation_name when 'group_acl_ids' then 'group_id' else 'user_id' end;
    if relation_name = 'responsible_ids' then
      -- These relation tables intentionally allow INSERT/DELETE, not UPDATE.
      -- Replace only moved/removed rows and keep unchanged memberships intact.
      execute format('delete from public.%I where %I = $1 and
        (not (user_id = any($2)) or position is distinct from array_position($2, user_id) - 1)',
        relation_table, entity_key) using p_id, ids;
      execute format('insert into public.%I (%I, workspace_id, user_id, position)
        select $1, $2, value, (ordinality - 1)::integer from unnest($3::uuid[]) with ordinality as x(value, ordinality)
        on conflict do nothing', relation_table, entity_key) using p_id, p_workspace_id, ids;
    else
      execute format('delete from public.%I where %I = $1 and not (%I = any($2))',
        relation_table, entity_key, subject_key) using p_id, ids;
      execute format('insert into public.%I (%I, workspace_id, %I)
        select $1, $2, value from unnest($3::uuid[]) value on conflict do nothing',
        relation_table, entity_key, subject_key) using p_id, p_workspace_id, ids;
    end if;
  end loop;

  if p_kind = 'objective' and p_change ? 'alignment_target_id' then
    delete from public.okr_objective_alignments
      where source_objective_id = p_id
        and target_objective_id is distinct from (p_change ->> 'alignment_target_id')::uuid;
    if p_change ->> 'alignment_target_id' is not null then
      insert into public.okr_objective_alignments(source_objective_id, target_objective_id, workspace_id)
        values (p_id, (p_change ->> 'alignment_target_id')::uuid, p_workspace_id)
        on conflict do nothing;
    end if;
  end if;
  if p_kind = 'key_result' and p_change ? 'breakdowns' then
    if jsonb_typeof(p_change -> 'breakdowns') <> 'array' then
      raise exception 'Invalid OKR breakdowns';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'allocated_value', allocated_value)
      order by position, id), '[]'::jsonb) into old_breakdowns
      from public.okr_kr_breakdowns where key_result_id = p_id;
    if old_breakdowns is distinct from p_change -> 'breakdowns' then
      delete from public.okr_kr_breakdowns where key_result_id = p_id;
      insert into public.okr_kr_breakdowns(key_result_id, workspace_id, user_id, allocated_value, position)
        select p_id, p_workspace_id, (value ->> 'user_id')::uuid,
          (value ->> 'allocated_value')::numeric, (ordinality - 1)::integer
        from jsonb_array_elements(p_change -> 'breakdowns') with ordinality;
    end if;
  end if;
end;
$$;
revoke all on function anttodo_private.apply_okr_change(text, uuid, uuid, jsonb) from public, anon;
grant execute on function anttodo_private.apply_okr_change(text, uuid, uuid, jsonb) to authenticated;

create function public.save_okr_changes(
  p_set_id uuid, p_changes jsonb, p_publish boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_set public.okr_sets;
  objective_change jsonb;
  kr_change jsonb;
  v_objective_id uuid;
  v_kr_id uuid;
begin
  if not coalesce(anttodo_private.can_edit_okr_set(p_set_id), false) then
    raise exception 'Only the OKR owner can edit an active cycle' using errcode = '42501';
  end if;
  -- Serialize saves/publications of the same set, including its version snapshot.
  select * into target_set from public.okr_sets where id = p_set_id for update;
  if target_set.id is null then
    raise exception 'OKR set is unavailable' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object'
    or jsonb_typeof(p_changes -> 'objectives') is distinct from 'array' then
    raise exception 'Invalid OKR changes';
  end if;
  for objective_change in select value from jsonb_array_elements(p_changes -> 'objectives') loop
    v_objective_id := (objective_change ->> 'id')::uuid;
    if not exists (select 1 from public.okr_objectives o
      where o.id = v_objective_id and o.set_id = target_set.id and o.workspace_id = target_set.workspace_id) then
      raise exception 'Objective does not belong to this OKR set' using errcode = '42501';
    end if;
    perform anttodo_private.apply_okr_change('objective', v_objective_id, target_set.workspace_id, objective_change);
    for kr_change in select value from jsonb_array_elements(coalesce(objective_change -> 'key_results', '[]'::jsonb)) loop
      v_kr_id := (kr_change ->> 'id')::uuid;
      if not exists (select 1 from public.okr_key_results kr
        where kr.id = v_kr_id and kr.objective_id = v_objective_id and kr.workspace_id = target_set.workspace_id) then
        raise exception 'Key Result does not belong to this Objective' using errcode = '42501';
      end if;
      perform anttodo_private.apply_okr_change('key_result', v_kr_id, target_set.workspace_id, kr_change);
    end loop;
  end loop;
  if p_publish then
    perform public.publish_okr_set(p_set_id);
  end if;
  return public.load_okr_set(target_set.workspace_id, target_set.cycle_id, target_set.owner_id);
end;
$$;
revoke all on function public.save_okr_changes(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_okr_changes(uuid, jsonb, boolean) to authenticated;
