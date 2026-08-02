create type public.label_kind as enum ('private', 'team');
create type public.label_access_scope as enum ('inherit', 'all', 'users', 'groups');

alter table public.labels
  add column kind public.label_kind,
  add column view_scope public.label_access_scope,
  add column manage_scope public.label_access_scope;

update public.labels
set
  kind = case visibility
    when 'private' then 'private'::public.label_kind
    else 'team'::public.label_kind
  end,
  view_scope = case visibility
    when 'workspace' then 'all'::public.label_access_scope
    else 'users'::public.label_access_scope
  end,
  manage_scope = 'users'::public.label_access_scope;

alter table public.labels
  alter column kind set not null,
  alter column kind set default 'private',
  alter column view_scope set not null,
  alter column view_scope set default 'all',
  alter column manage_scope set not null,
  alter column manage_scope set default 'users';

-- 子标签始终继承父标签权限，根标签不参与继承链。
update public.labels
set inherit_permissions = (parent_id is not null);

create or replace function anttodo_private.force_label_permission_inheritance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.inherit_permissions := (new.parent_id is not null);
  return new;
end;
$$;

revoke all on function anttodo_private.force_label_permission_inheritance() from public, anon, authenticated;

create trigger labels_force_permission_inheritance
before insert or update of parent_id, inherit_permissions on public.labels
for each row execute function anttodo_private.force_label_permission_inheritance();

alter table public.labels
  add constraint labels_parent_permissions_always_inherited
  check (inherit_permissions = (parent_id is not null));

alter table public.labels
  add constraint labels_id_workspace_unique unique (id, workspace_id);

alter table public.label_acl rename to label_user_acl;
alter table public.label_user_acl add column workspace_id uuid;

update public.label_user_acl acl
set workspace_id = label.workspace_id
from public.labels label
where label.id = acl.label_id;

delete from public.label_user_acl acl
where not exists (
  select 1
  from public.workspace_members member
  where member.workspace_id = acl.workspace_id
    and member.user_id = acl.user_id
);

alter table public.label_user_acl
  alter column workspace_id set not null,
  drop constraint label_acl_label_id_fkey,
  drop constraint label_acl_user_id_fkey,
  add constraint label_user_acl_label_workspace_fkey
    foreign key (label_id, workspace_id)
    references public.labels(id, workspace_id) on delete cascade,
  add constraint label_user_acl_member_fkey
    foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade;

alter index public.label_acl_pkey rename to label_user_acl_pkey;
alter index public.label_acl_user_idx rename to label_user_acl_user_idx;
create index label_user_acl_workspace_label_idx
on public.label_user_acl(workspace_id, label_id);

create table public.label_group_acl (
  label_id uuid not null,
  workspace_id uuid not null,
  group_id uuid not null,
  permission public.label_permission not null default 'view',
  created_at timestamptz not null default now(),
  primary key (label_id, group_id),
  foreign key (label_id, workspace_id)
    references public.labels(id, workspace_id) on delete cascade,
  foreign key (group_id, workspace_id)
    references public.user_groups(id, workspace_id) on delete cascade
);

create index label_group_acl_workspace_label_idx
on public.label_group_acl(workspace_id, label_id);
create index label_group_acl_group_idx
on public.label_group_acl(group_id, label_id);

alter table public.label_group_acl enable row level security;

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

  if exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = current_label.workspace_id
      and member.user_id = target_user
      and member.role in ('owner', 'admin')
  ) then
    return 2;
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
    elsif current_label.created_by = target_user then
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

create or replace function anttodo_private.label_permission_level(target_label uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select anttodo_private.label_permission_level_for_user(
    target_label,
    (select auth.uid())
  );
$$;

drop policy label_acl_select on public.label_user_acl;
drop policy label_acl_insert on public.label_user_acl;
drop policy label_acl_update on public.label_user_acl;
drop policy label_acl_delete on public.label_user_acl;

create policy label_user_acl_select
on public.label_user_acl for select to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2);
create policy label_user_acl_insert
on public.label_user_acl for insert to authenticated
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (select anttodo_private.is_workspace_member(workspace_id))
);
create policy label_user_acl_update
on public.label_user_acl for update to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2)
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (select anttodo_private.is_workspace_member(workspace_id))
);
create policy label_user_acl_delete
on public.label_user_acl for delete to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2);

create policy label_group_acl_select
on public.label_group_acl for select to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2);
create policy label_group_acl_insert
on public.label_group_acl for insert to authenticated
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (select anttodo_private.is_workspace_member(workspace_id))
);
create policy label_group_acl_update
on public.label_group_acl for update to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2)
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (select anttodo_private.is_workspace_member(workspace_id))
);
create policy label_group_acl_delete
on public.label_group_acl for delete to authenticated
using ((select anttodo_private.label_permission_level(label_id)) >= 2);

alter policy labels_update on public.labels
using ((select anttodo_private.label_permission_level(id)) >= 2)
with check (
  (select anttodo_private.is_workspace_member(workspace_id))
  and (
    parent_id is null
    or (select anttodo_private.label_permission_level(parent_id)) >= 2
  )
);

create or replace function anttodo_private.validate_label_access_subjects(
  p_workspace_id uuid,
  p_view_scope public.label_access_scope,
  p_manage_scope public.label_access_scope,
  p_view_subject_ids uuid[],
  p_manage_subject_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  subject_id uuid;
begin
  if p_view_scope in ('inherit', 'all') and cardinality(coalesce(p_view_subject_ids, array[]::uuid[])) > 0 then
    raise exception 'Inherited or all-users visibility cannot include selected subjects' using errcode = '22023';
  end if;
  if p_manage_scope in ('inherit', 'all') and cardinality(coalesce(p_manage_subject_ids, array[]::uuid[])) > 0 then
    raise exception 'Inherited or all-users management cannot include selected subjects' using errcode = '22023';
  end if;
  if p_view_scope in ('users', 'groups') and cardinality(coalesce(p_view_subject_ids, array[]::uuid[])) = 0 then
    raise exception 'A restricted visibility scope requires at least one subject' using errcode = '22023';
  end if;
  if p_manage_scope in ('users', 'groups') and cardinality(coalesce(p_manage_subject_ids, array[]::uuid[])) = 0 then
    raise exception 'A restricted management scope requires at least one subject' using errcode = '22023';
  end if;

  if p_view_scope = 'users' or p_manage_scope = 'users' then
    foreach subject_id in array (
      case
        when p_view_scope = 'users' and p_manage_scope = 'users'
          then coalesce(p_view_subject_ids, array[]::uuid[]) || coalesce(p_manage_subject_ids, array[]::uuid[])
        when p_view_scope = 'users' then coalesce(p_view_subject_ids, array[]::uuid[])
        else coalesce(p_manage_subject_ids, array[]::uuid[])
      end
    ) loop
      if not exists (
        select 1 from public.workspace_members member
        where member.workspace_id = p_workspace_id and member.user_id = subject_id
      ) then
        raise exception 'Selected user is not a workspace member' using errcode = '23503';
      end if;
    end loop;
  end if;

  if p_view_scope = 'groups' or p_manage_scope = 'groups' then
    foreach subject_id in array (
      case
        when p_view_scope = 'groups' and p_manage_scope = 'groups'
          then coalesce(p_view_subject_ids, array[]::uuid[]) || coalesce(p_manage_subject_ids, array[]::uuid[])
        when p_view_scope = 'groups' then coalesce(p_view_subject_ids, array[]::uuid[])
        else coalesce(p_manage_subject_ids, array[]::uuid[])
      end
    ) loop
      if not exists (
        select 1 from public.user_groups user_group
        where user_group.workspace_id = p_workspace_id and user_group.id = subject_id
      ) then
        raise exception 'Selected group does not belong to the workspace' using errcode = '23503';
      end if;
    end loop;
  end if;
end;
$$;

create or replace function anttodo_private.replace_label_access(
  p_label_id uuid,
  p_workspace_id uuid,
  p_kind public.label_kind,
  p_view_scope public.label_access_scope,
  p_manage_scope public.label_access_scope,
  p_view_subject_ids uuid[],
  p_manage_subject_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not exists (
      select 1 from public.labels label
      where label.id = p_label_id and label.workspace_id = p_workspace_id
    )
    or anttodo_private.label_permission_level(p_label_id) < 2
  then
    raise exception 'Label management permission required' using errcode = '42501';
  end if;

  delete from public.label_user_acl where label_id = p_label_id;
  delete from public.label_group_acl where label_id = p_label_id;

  if p_kind = 'private' then
    return;
  end if;

  perform anttodo_private.validate_label_access_subjects(
    p_workspace_id, p_view_scope, p_manage_scope,
    p_view_subject_ids, p_manage_subject_ids
  );

  if p_view_scope = 'users' or p_manage_scope = 'users' then
    insert into public.label_user_acl(label_id, workspace_id, user_id, permission)
    select
      p_label_id,
      p_workspace_id,
      subject_id,
      case when bool_or(permission = 'edit') then 'edit'::public.label_permission
        else 'view'::public.label_permission end
    from (
      select unnest(coalesce(p_view_subject_ids, array[]::uuid[])) as subject_id,
        'view'::public.label_permission as permission
      where p_view_scope = 'users'
      union all
      select unnest(coalesce(p_manage_subject_ids, array[]::uuid[])),
        'edit'::public.label_permission
      where p_manage_scope = 'users'
    ) selected
    group by subject_id;
  end if;

  if p_view_scope = 'groups' or p_manage_scope = 'groups' then
    insert into public.label_group_acl(label_id, workspace_id, group_id, permission)
    select
      p_label_id,
      p_workspace_id,
      subject_id,
      case when bool_or(permission = 'edit') then 'edit'::public.label_permission
        else 'view'::public.label_permission end
    from (
      select unnest(coalesce(p_view_subject_ids, array[]::uuid[])) as subject_id,
        'view'::public.label_permission as permission
      where p_view_scope = 'groups'
      union all
      select unnest(coalesce(p_manage_subject_ids, array[]::uuid[])),
        'edit'::public.label_permission
      where p_manage_scope = 'groups'
    ) selected
    group by subject_id;
  end if;
end;
$$;

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
    coalesce((select max(position) + 1 from public.labels where workspace_id = p_workspace_id), 0),
    viewer
  ) returning * into created_label;

  perform anttodo_private.replace_label_access(
    created_label.id, p_workspace_id, p_kind, p_view_scope, p_manage_scope,
    p_view_subject_ids, p_manage_subject_ids
  );
  return created_label;
end;
$$;

create or replace function anttodo_private.update_label_with_access_impl(
  p_label_id uuid,
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
  current_label public.labels%rowtype;
  updated_label public.labels;
begin
  select * into current_label from public.labels where id = p_label_id;
  if not found or anttodo_private.label_permission_level(p_label_id) < 2 then
    raise exception 'Label management permission required' using errcode = '42501';
  end if;
  if p_kind = 'team' then
    if current_label.parent_id is null and (p_view_scope = 'inherit' or p_manage_scope = 'inherit') then
      raise exception 'Root labels cannot inherit access scopes' using errcode = '22023';
    end if;
    perform anttodo_private.validate_label_access_subjects(
      current_label.workspace_id, p_view_scope, p_manage_scope,
      p_view_subject_ids, p_manage_subject_ids
    );
  end if;

  perform anttodo_private.replace_label_access(
    p_label_id, current_label.workspace_id, p_kind, p_view_scope, p_manage_scope,
    p_view_subject_ids, p_manage_subject_ids
  );

  update public.labels
  set name = btrim(p_name), color = p_color, kind = p_kind,
    view_scope = p_view_scope, manage_scope = p_manage_scope,
    inherit_permissions = (current_label.parent_id is not null)
  where id = p_label_id
  returning * into updated_label;
  return updated_label;
end;
$$;

create or replace function public.create_label_with_access(
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
language sql
security invoker
set search_path = ''
as $$
  select anttodo_private.create_label_with_access_impl(
    p_workspace_id, p_parent_id, p_name, p_color, p_kind,
    p_view_scope, p_manage_scope, p_view_subject_ids,
    p_manage_subject_ids, p_inherit_permissions
  );
$$;

create or replace function public.update_label_with_access(
  p_label_id uuid,
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
language sql
security invoker
set search_path = ''
as $$
  select anttodo_private.update_label_with_access_impl(
    p_label_id, p_name, p_color, p_kind, p_view_scope, p_manage_scope,
    p_view_subject_ids, p_manage_subject_ids, p_inherit_permissions
  );
$$;

create or replace function public.list_label_permission_levels(p_workspace_id uuid)
returns table(label_id uuid, permission_level integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select label.id, anttodo_private.label_permission_level(label.id)
  from public.labels label
  where label.workspace_id = p_workspace_id
    and anttodo_private.label_permission_level(label.id) >= 1;
$$;

revoke all on function anttodo_private.validate_label_access_subjects(
  uuid, public.label_access_scope, public.label_access_scope, uuid[], uuid[]
) from public, anon;
revoke all on function anttodo_private.replace_label_access(
  uuid, uuid, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[]
) from public, anon;
revoke all on function anttodo_private.create_label_with_access_impl(
  uuid, uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) from public, anon;
revoke all on function anttodo_private.update_label_with_access_impl(
  uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) from public, anon;

grant execute on function anttodo_private.validate_label_access_subjects(
  uuid, public.label_access_scope, public.label_access_scope, uuid[], uuid[]
) to authenticated;
grant execute on function anttodo_private.replace_label_access(
  uuid, uuid, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[]
) to authenticated;
grant execute on function anttodo_private.create_label_with_access_impl(
  uuid, uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) to authenticated;
grant execute on function anttodo_private.update_label_with_access_impl(
  uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) to authenticated;

revoke all on function public.create_label_with_access(
  uuid, uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) from public, anon;
revoke all on function public.update_label_with_access(
  uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) from public, anon;
revoke all on function public.list_label_permission_levels(uuid) from public, anon;

grant execute on function public.create_label_with_access(
  uuid, uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) to authenticated;
grant execute on function public.update_label_with_access(
  uuid, text, text, public.label_kind, public.label_access_scope,
  public.label_access_scope, uuid[], uuid[], boolean
) to authenticated;
grant execute on function public.list_label_permission_levels(uuid) to authenticated;

grant select, insert, update, delete on public.label_user_acl to authenticated;
grant select, insert, update, delete on public.label_group_acl to authenticated;
grant all on public.label_user_acl, public.label_group_acl to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'label_group_acl'
    )
  then
    alter publication supabase_realtime add table public.label_group_acl;
  end if;
end;
$$;

alter table public.labels drop column visibility;
drop type public.label_visibility;
