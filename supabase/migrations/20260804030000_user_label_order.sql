-- Per-user top-level label order, sibling-scoped create position,
-- and RPCs for nested / top-level reordering.

create table public.user_label_order (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  position integer not null,
  primary key (user_id, label_id),
  constraint user_label_order_workspace_member_fkey
    foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete cascade
);

create index user_label_order_user_workspace_position_idx
  on public.user_label_order (user_id, workspace_id, position);

alter table public.user_label_order enable row level security;

create policy user_label_order_select_self
on public.user_label_order
for select to authenticated
using (user_id = (select auth.uid()));

create policy user_label_order_insert_self
on public.user_label_order
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
  and exists (
    select 1
    from public.labels label
    where label.id = label_id
      and label.workspace_id = workspace_id
      and label.parent_id is null
      and (select anttodo_private.label_permission_level(label.id)) >= 1
  )
);

create policy user_label_order_update_self
on public.user_label_order
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
  and exists (
    select 1
    from public.labels label
    where label.id = label_id
      and label.workspace_id = workspace_id
      and label.parent_id is null
      and (select anttodo_private.label_permission_level(label.id)) >= 1
  )
);

create policy user_label_order_delete_self
on public.user_label_order
for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_label_order to authenticated;

-- Drop personal order rows when a top-level label is nested under another.
create or replace function anttodo_private.clear_user_label_order_on_nest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.parent_id is null and new.parent_id is not null then
    delete from public.user_label_order where label_id = new.id;
  end if;
  return new;
end;
$$;

create trigger labels_clear_user_order_on_nest
after update of parent_id on public.labels
for each row
execute function anttodo_private.clear_user_label_order_on_nest();

-- Sibling-scoped position when creating labels.
create or replace function anttodo_private.create_label_with_access_impl(
  p_workspace_id uuid,
  p_parent_id uuid,
  p_name text,
  p_color text,
  p_kind public.label_kind,
  p_view_scope public.label_access_scope,
  p_manage_scope public.label_access_scope,
  p_view_subject_ids uuid[],
  p_manage_subject_ids uuid[],
  p_inherit_permissions boolean
)
returns public.labels
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := (select auth.uid());
  created_label public.labels;
begin
  if viewer is null or not anttodo_private.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;
  if p_parent_id is not null and anttodo_private.label_permission_level(p_parent_id) < 2 then
    raise exception 'Parent label management permission required' using errcode = '42501';
  end if;
  if p_kind = 'team' then
    if p_parent_id is null and (p_view_scope = 'inherit' or p_manage_scope = 'inherit') then
      raise exception 'Root labels cannot inherit access scopes' using errcode = '22023';
    end if;
    perform anttodo_private.validate_label_access_subjects(
      p_workspace_id, p_view_scope, p_manage_scope,
      p_view_subject_ids, p_manage_subject_ids
    );
  end if;

  insert into public.labels(
    workspace_id, parent_id, name, color, kind, view_scope, manage_scope,
    inherit_permissions, position, created_by
  ) values (
    p_workspace_id, p_parent_id, btrim(p_name), p_color, p_kind,
    p_view_scope, p_manage_scope, (p_parent_id is not null),
    coalesce((
      select max(sibling.position) + 1
      from public.labels sibling
      where sibling.workspace_id = p_workspace_id
        and sibling.parent_id is not distinct from p_parent_id
    ), 0),
    viewer
  ) returning * into created_label;

  perform anttodo_private.replace_label_access(
    created_label.id, p_workspace_id, p_kind, p_view_scope, p_manage_scope,
    p_view_subject_ids, p_manage_subject_ids
  );
  return created_label;
end;
$$;

create or replace function public.reorder_child_labels(
  p_parent_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := (select auth.uid());
  parent_workspace uuid;
  child_count integer;
  ordered_count integer;
begin
  if viewer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_parent_id is null then
    raise exception 'Parent label is required' using errcode = '22023';
  end if;
  if p_ordered_ids is null then
    raise exception 'Ordered label ids are required' using errcode = '22023';
  end if;

  select workspace_id into parent_workspace
  from public.labels
  where id = p_parent_id;
  if parent_workspace is null then
    raise exception 'Parent label not found' using errcode = 'P0002';
  end if;
  if anttodo_private.label_permission_level(p_parent_id) < 2 then
    raise exception 'Parent label management permission required' using errcode = '42501';
  end if;

  select count(*) into child_count
  from public.labels
  where parent_id = p_parent_id;

  select count(distinct id) into ordered_count
  from unnest(p_ordered_ids) as id;

  if ordered_count <> cardinality(p_ordered_ids) then
    raise exception 'Ordered label ids must be unique' using errcode = '22023';
  end if;
  if ordered_count <> child_count then
    raise exception 'Ordered label ids must match all direct children' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_ordered_ids) as ordered(id)
    left join public.labels child
      on child.id = ordered.id
     and child.parent_id = p_parent_id
    where child.id is null
  ) then
    raise exception 'Ordered label ids must be direct children of the parent' using errcode = '22023';
  end if;

  update public.labels as child
  set position = ordered.ordinality - 1
  from unnest(p_ordered_ids) with ordinality as ordered(id, ordinality)
  where child.id = ordered.id;
end;
$$;

revoke all on function public.reorder_child_labels(uuid, uuid[]) from public;
grant execute on function public.reorder_child_labels(uuid, uuid[]) to authenticated;

create or replace function public.set_user_top_level_label_order(
  p_workspace_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := (select auth.uid());
  ordered_count integer;
begin
  if viewer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not anttodo_private.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;
  if p_ordered_ids is null then
    raise exception 'Ordered label ids are required' using errcode = '22023';
  end if;

  select count(distinct id) into ordered_count
  from unnest(p_ordered_ids) as id;

  if ordered_count <> cardinality(p_ordered_ids) then
    raise exception 'Ordered label ids must be unique' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_ordered_ids) as ordered(id)
    left join public.labels label
      on label.id = ordered.id
     and label.workspace_id = p_workspace_id
     and label.parent_id is null
    where label.id is null
      or anttodo_private.label_permission_level(ordered.id) < 1
  ) then
    raise exception 'Ordered label ids must be visible top-level labels' using errcode = '42501';
  end if;

  delete from public.user_label_order
  where user_id = viewer
    and workspace_id = p_workspace_id;

  insert into public.user_label_order (user_id, workspace_id, label_id, position)
  select viewer, p_workspace_id, ordered.id, ordered.ordinality - 1
  from unnest(p_ordered_ids) with ordinality as ordered(id, ordinality);
end;
$$;

revoke all on function public.set_user_top_level_label_order(uuid, uuid[]) from public;
grant execute on function public.set_user_top_level_label_order(uuid, uuid[]) to authenticated;
