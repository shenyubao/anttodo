-- labels_select calls label_permission_level(id) for INSERT ... RETURNING,
-- but a function that queries labels cannot see the row being inserted by the
-- same statement. Check the new row's own columns for its creator and keep the
-- inherited parent permission in the predicate. Existing rows and other users
-- continue through the full permission function.
alter policy labels_select
on public.labels
using (
  (
    created_by = (select auth.uid())
    and (
      not inherit_permissions
      or parent_id is null
      or (select anttodo_private.label_permission_level(parent_id)) >= 1
    )
  )
  or (select anttodo_private.label_permission_level(id)) >= 1
);
