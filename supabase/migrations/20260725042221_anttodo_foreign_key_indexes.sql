-- Cover foreign-key columns used by joins, deletes, audit views and RLS helpers.
create index activity_events_workspace_idx
  on public.activity_events(workspace_id);
create index activity_events_actor_idx
  on public.activity_events(actor_id);
create index connector_instances_workspace_idx
  on public.connector_instances(workspace_id);
create index connector_instances_created_by_idx
  on public.connector_instances(created_by);
create index external_task_links_task_idx
  on public.external_task_links(task_id);
create index labels_parent_idx
  on public.labels(parent_id);
create index labels_created_by_idx
  on public.labels(created_by);
create index sync_conflicts_task_idx
  on public.sync_conflicts(task_id);
create index sync_conflicts_resolved_by_idx
  on public.sync_conflicts(resolved_by);
create index sync_outbox_connector_idx
  on public.sync_outbox(connector_id);
create index sync_outbox_task_idx
  on public.sync_outbox(task_id);
create index tasks_created_by_idx
  on public.tasks(created_by);
create index workspace_invites_created_by_idx
  on public.workspace_invites(created_by);
create index workspaces_created_by_idx
  on public.workspaces(created_by);
