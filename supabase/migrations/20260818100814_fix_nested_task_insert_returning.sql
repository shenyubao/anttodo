-- tasks_select currently calls can_view_task(id). That helper looks the row
-- up from public.tasks, which cannot see the row being inserted by the same
-- statement. PostgREST INSERT ... RETURNING therefore fails for nested tasks
-- even when the INSERT WITH CHECK policy allows the write. Visibility for a
-- nested task is the same as its parent, so authorize RETURNING from the
-- parent (which already exists) and keep can_view_task(id) for every other
-- row, including roots.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    (
      parent_task_id is not null
      and (select anttodo_private.can_view_task(parent_task_id))
    )
    or (select anttodo_private.can_view_task(id))
  );
