-- Private labels are creator-only, including for workspace owners and admins.
-- Owner/admin manage privilege applies only to team labels and still respects
-- inheritance from private ancestors.

create or replace function anttodo_private.label_permission_level_for_user(
  target_label uuid,
  target_user uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_label public.labels%rowtype;
  local_can_view boolean;
  local_can_manage boolean;
  effective_can_view boolean := true;
  effective_can_manage boolean := true;
  is_workspace_admin boolean;
begin
  if target_user is null then
    return 0;
  end if;

  select * into current_label
  from public.labels
  where id = target_label;

  if not found then
    return 0;
  end if;

  loop
    if not exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = current_label.workspace_id
        and member.user_id = target_user
    ) then
      local_can_view := false;
      local_can_manage := false;
    elsif current_label.kind = 'private' then
      local_can_view := current_label.created_by = target_user;
      local_can_manage := local_can_view;
    else
      select exists (
        select 1
        from public.workspace_members member
        where member.workspace_id = current_label.workspace_id
          and member.user_id = target_user
          and member.role in ('owner', 'admin')
      ) into is_workspace_admin;

      if is_workspace_admin or current_label.created_by = target_user then
        local_can_view := true;
        local_can_manage := true;
      else
        local_can_manage := current_label.manage_scope = 'inherit'
          or current_label.manage_scope = 'all'
          or (current_label.manage_scope = 'users' and exists (
            select 1 from public.label_user_acl acl
            where acl.label_id = current_label.id
              and acl.user_id = target_user
              and acl.permission = 'edit'
          ))
          or (current_label.manage_scope = 'groups' and exists (
            select 1
            from public.label_group_acl acl
            join public.user_group_members membership
              on membership.group_id = acl.group_id
             and membership.workspace_id = acl.workspace_id
            where acl.label_id = current_label.id
              and acl.permission = 'edit'
              and membership.user_id = target_user
          ));
        local_can_view := local_can_manage
          or current_label.view_scope = 'inherit'
          or current_label.view_scope = 'all'
          or (current_label.view_scope = 'users' and exists (
            select 1 from public.label_user_acl acl
            where acl.label_id = current_label.id
              and acl.user_id = target_user
              and acl.permission in ('view', 'edit')
          ))
          or (current_label.view_scope = 'groups' and exists (
            select 1
            from public.label_group_acl acl
            join public.user_group_members membership
              on membership.group_id = acl.group_id
             and membership.workspace_id = acl.workspace_id
            where acl.label_id = current_label.id
              and acl.permission in ('view', 'edit')
              and membership.user_id = target_user
          ));
      end if;
    end if;

    effective_can_view := effective_can_view and local_can_view;
    effective_can_manage := effective_can_manage and local_can_manage;
    exit when not effective_can_view
      or not current_label.inherit_permissions
      or current_label.parent_id is null;

    select * into current_label
    from public.labels
    where id = current_label.parent_id;
    exit when not found;
  end loop;

  return case
    when effective_can_manage then 2
    when effective_can_view then 1
    else 0
  end;
end;
$$;
