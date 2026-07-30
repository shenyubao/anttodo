create or replace function public.merge_label_into(
  source_label uuid,
  target_label uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_workspace uuid;
  target_workspace uuid;
begin
  if source_label = target_label then
    raise exception 'A label cannot be merged into itself';
  end if;

  select workspace_id into source_workspace
  from public.labels
  where id = source_label and not is_system;

  select workspace_id into target_workspace
  from public.labels
  where id = target_label;

  if source_workspace is null or target_workspace is null
    or source_workspace <> target_workspace then
    raise exception 'Labels must exist in the same workspace';
  end if;

  if anttodo_private.label_permission_level(source_label) < 2
    or anttodo_private.label_permission_level(target_label) < 2 then
    raise exception 'Insufficient label permissions';
  end if;

  if exists (
    with recursive descendants as (
      select id from public.labels where parent_id = source_label
      union all
      select labels.id
      from public.labels
      join descendants on labels.parent_id = descendants.id
    )
    select 1 from descendants where id = target_label
  ) then
    raise exception 'A label cannot be merged into its descendant';
  end if;

  insert into public.task_labels (task_id, label_id)
  select task_id, target_label
  from public.task_labels
  where label_id = source_label
  on conflict do nothing;

  update public.labels
  set parent_id = target_label, inherit_permissions = true
  where parent_id = source_label;

  delete from public.labels where id = source_label;
end;
$$;

revoke all on function public.merge_label_into(uuid, uuid) from public;
grant execute on function public.merge_label_into(uuid, uuid) to authenticated;
