-- Preserve historical values and records; all current O progress is derived from KR.
update public.okr_objectives set progress_mode = 'key_results' where progress_mode <> 'key_results';
alter table public.okr_objectives alter column progress_mode set default 'key_results';
alter table public.okr_objectives add constraint okr_objectives_derived_progress_check check (progress_mode = 'key_results');

-- Status-only legacy calls remain compatible, but no longer create O records or write a value.
create or replace function public.update_okr_objective_progress(
  p_objective_id uuid, p_current_value numeric, p_status public.okr_progress_status, p_detail text default ''
)
returns public.okr_objectives
language plpgsql security invoker set search_path = ''
as $$
declare updated public.okr_objectives;
begin
  if not anttodo_private.owns_okr_objective(p_objective_id) then
    raise exception 'Only the OKR owner can update progress';
  end if;
  if nullif(btrim(coalesce(p_detail, '')), '') is not null then
    raise exception 'Objective progress is derived from Key Results; record progress on a Key Result' using errcode = '23514';
  end if;
  update public.okr_objectives set progress_status = p_status where id = p_objective_id returning * into updated;
  return updated;
end;
$$;

drop policy okr_progress_records_insert on public.okr_progress_records;
create policy okr_progress_records_insert on public.okr_progress_records for insert to authenticated
with check (
  actor_id = (select auth.uid()) and objective_id is null and key_result_id is not null
  and (select anttodo_private.owns_okr_key_result(key_result_id))
);

-- Also enforce the invariant for service-side inserts, without touching historical records.
create function anttodo_private.require_key_result_progress_record()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.objective_id is not null then
    raise exception 'Record progress on a Key Result' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function anttodo_private.require_key_result_progress_record() from public, anon;
create trigger okr_progress_records_key_results_only before insert on public.okr_progress_records
for each row execute function anttodo_private.require_key_result_progress_record();
