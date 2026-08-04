-- Allow editors to permanently delete tasks that are already in the trash.
grant delete on public.tasks to authenticated;

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
using (
  deleted_at is not null
  and (select anttodo_private.can_edit_task(id))
);
