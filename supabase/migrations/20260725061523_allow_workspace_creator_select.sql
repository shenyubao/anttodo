alter policy workspaces_select
on public.workspaces
using (
  (select auth.uid()) = created_by
  or (select anttodo_private.is_workspace_member(id))
);
