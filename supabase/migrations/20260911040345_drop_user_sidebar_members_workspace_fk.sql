-- user_sidebar_members has two FKs to workspace_members plus a direct FK to
-- workspaces. PostgREST treats that as two many-to-many paths and rejects
-- workspace_members embeds of workspaces (PGRST201). Membership FKs already
-- constrain workspace_id, so the direct workspaces FK is redundant.

alter table public.user_sidebar_members
  drop constraint if exists user_sidebar_members_workspace_id_fkey;
