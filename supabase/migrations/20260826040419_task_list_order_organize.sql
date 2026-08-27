begin;

-- List placement is organization, not content edit. Connector/external tasks are
-- read-only for title/body but must still be movable in a custom-sorted list.
-- Adding a task currently rewrites the visible order; failing the whole RPC when
-- one sibling is external made create-task look like it failed.

drop policy if exists task_list_placements_insert on public.task_list_placements;
create policy task_list_placements_insert
on public.task_list_placements for insert to authenticated
with check (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_organize_task(task_id))
  and exists (
    select 1 from public.tasks t
    where t.id = task_id and t.workspace_id = workspace_id
  )
  and (
    section_id is null
    or exists (
      select 1 from public.task_sections s
      where s.id = section_id
        and s.workspace_id = workspace_id
        and s.list_key = task_list_placements.list_key
    )
  )
);

drop policy if exists task_list_placements_update on public.task_list_placements;
create policy task_list_placements_update
on public.task_list_placements for update to authenticated
using (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_organize_task(task_id))
)
with check (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_organize_task(task_id))
  and exists (
    select 1 from public.tasks t
    where t.id = task_id and t.workspace_id = workspace_id
  )
  and (
    section_id is null
    or exists (
      select 1 from public.task_sections s
      where s.id = section_id
        and s.workspace_id = workspace_id
        and s.list_key = task_list_placements.list_key
    )
  )
);

drop policy if exists task_list_placements_delete on public.task_list_placements;
create policy task_list_placements_delete
on public.task_list_placements for delete to authenticated
using (
  (select anttodo_private.can_edit_task_list(workspace_id, list_key))
  and (select anttodo_private.can_organize_task(task_id))
);

create or replace function public.set_task_list_order(
  p_workspace_id uuid,
  p_list_key text,
  p_section_id uuid,
  p_task_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_task_id uuid;
  ordinal integer := 0;
begin
  if not anttodo_private.can_edit_task_list(p_workspace_id, p_list_key) then
    raise exception 'Insufficient list permission' using errcode = '42501';
  end if;

  if p_section_id is not null and not exists (
    select 1 from public.task_sections s
    where s.id = p_section_id
      and s.workspace_id = p_workspace_id
      and s.list_key = p_list_key
  ) then
    raise exception 'Invalid task section' using errcode = '22023';
  end if;

  foreach current_task_id in array coalesce(p_task_ids, array[]::uuid[]) loop
    -- Skip siblings the caller cannot organize (external/view-only) or that no
    -- longer exist, so placing a newly created task does not fail the whole list.
    if not exists (
      select 1 from public.tasks t
      where t.id = current_task_id and t.workspace_id = p_workspace_id
    ) or not anttodo_private.can_organize_task(current_task_id) then
      continue;
    end if;

    insert into public.task_list_placements (
      workspace_id, list_key, task_id, section_id, position
    ) values (
      p_workspace_id, p_list_key, current_task_id, p_section_id, ordinal
    )
    on conflict (workspace_id, list_key, task_id)
    do update set section_id = excluded.section_id, position = excluded.position;

    ordinal := ordinal + 1;
  end loop;
end;
$$;

revoke all on function public.set_task_list_order(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.set_task_list_order(uuid, text, uuid, uuid[]) to authenticated;

commit;
