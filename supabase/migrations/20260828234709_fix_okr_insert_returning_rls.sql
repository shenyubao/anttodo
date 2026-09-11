-- INSERT ... RETURNING also evaluates the SELECT policy. The original helper
-- functions query the row being inserted, which is not visible to that nested
-- query until the INSERT statement completes. Give owners a direct path based
-- on the new row (or its already-visible parent), while preserving the existing
-- visibility checks for every other viewer.

drop policy okr_sets_select on public.okr_sets;
create policy okr_sets_select on public.okr_sets for select to authenticated
using (
  owner_id = (select auth.uid())
  or (select anttodo_private.can_view_okr_set(id))
);

drop policy okr_objectives_select on public.okr_objectives;
create policy okr_objectives_select on public.okr_objectives for select to authenticated
using (
  (select anttodo_private.is_okr_set_owner(set_id))
  or (select anttodo_private.can_view_okr_objective(id))
);

drop policy okr_key_results_select on public.okr_key_results;
create policy okr_key_results_select on public.okr_key_results for select to authenticated
using (
  (select anttodo_private.is_okr_objective_owner(objective_id))
  or (select anttodo_private.can_view_okr_key_result(id))
);
