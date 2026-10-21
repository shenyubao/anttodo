-- Roll back user-space system labels (20260911073448). That migration was
-- applied, then removed from the repo after the feature was cancelled.

drop trigger if exists labels_guard_system on public.labels;
drop trigger if exists profiles_sync_user_space_label_name on public.profiles;
drop trigger if exists workspace_members_user_space_label on public.workspace_members;

drop function if exists anttodo_private.on_profile_user_space_label_name();
drop function if exists anttodo_private.on_workspace_member_user_space_label();
drop function if exists anttodo_private.sync_user_space_label_names(uuid);
drop function if exists anttodo_private.ensure_user_space_label(uuid, uuid);
drop function if exists anttodo_private.user_space_label_name(uuid);
drop function if exists anttodo_private.guard_system_label();
drop function if exists anttodo_private.allow_system_label_write();

create or replace function anttodo_private.adjust_label_live_task_count(
  p_label_id uuid,
  p_delta integer,
  p_enforce_limit boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_count integer;
begin
  if p_delta = 0 then
    return;
  end if;

  if not exists (select 1 from public.labels where id = p_label_id) then
    return;
  end if;

  insert into anttodo_private.label_task_counts(label_id, task_count)
  values (p_label_id, 0)
  on conflict (label_id) do nothing;

  perform 1
  from anttodo_private.label_task_counts
  where label_id = p_label_id
  for update;

  update anttodo_private.label_task_counts
  set task_count = greatest(0, task_count + p_delta)
  where label_id = p_label_id
  returning task_count into next_count;

  if p_enforce_limit and p_delta > 0 and next_count > 10000 then
    raise exception 'label_task_limit_exceeded';
  end if;
end;
$$;

create or replace function anttodo_private.can_organize_task(target_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.tasks t
      join public.tasks r on r.id=anttodo_private.task_root_id(t.id)
      where t.id=target_task
        and (
          t.created_by=(select auth.uid()) or t.assignee_id=(select auth.uid())
          or r.created_by=(select auth.uid()) or r.assignee_id=(select auth.uid())
          or anttodo_private.is_workspace_admin(t.workspace_id)
          or exists(select 1 from public.task_labels tl where tl.task_id=r.id)
        )
    )
    and not exists(
      select 1 from public.task_labels tl
      where tl.task_id=anttodo_private.task_root_id(target_task)
        and anttodo_private.label_permission_level(tl.label_id)<2
    )
$$;

create or replace function anttodo_private.can_user_view_task(target_task uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_user is not null
    and exists (
      select 1 from public.tasks t
      join public.workspace_members wm on wm.workspace_id=t.workspace_id and wm.user_id=target_user
      where t.id=target_task
    )
    and not exists (
      select 1 from public.task_labels tl
      where tl.task_id=anttodo_private.task_root_id(target_task)
        and anttodo_private.label_permission_level_for_user(tl.label_id,target_user)<1
    )
$$;

create or replace function anttodo_private.can_view_task(target_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists(select 1 from public.tasks t where t.id=target_task and anttodo_private.is_workspace_member(t.workspace_id))
    and not exists(
      select 1 from public.task_labels tl
      where tl.task_id=anttodo_private.task_root_id(target_task)
        and anttodo_private.label_permission_level(tl.label_id)<1
    )
$$;

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

create or replace function anttodo_private.record_task_label_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_task_id uuid := coalesce(new.task_id, old.task_id);
  selected_label_id uuid := coalesce(new.label_id, old.label_id);
  selected_workspace_id uuid;
  selected_label_name text;
  selected_label_color text;
begin
  select t.workspace_id into selected_workspace_id from public.tasks t where t.id = selected_task_id;
  if selected_workspace_id is null then return coalesce(new, old); end if;
  select l.name, l.color into selected_label_name, selected_label_color
  from public.labels l where l.id = selected_label_id;

  insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
  values (
    selected_workspace_id,
    selected_task_id,
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'task.label_added' else 'task.label_removed' end,
    jsonb_build_object(
      'label_id', selected_label_id,
      'label_name', coalesce(selected_label_name, '标签'),
      'label_color', coalesce(selected_label_color, '#8f959e')
    )
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.create_task_with_labels(
  p_workspace_id uuid,
  p_title text,
  p_label_ids uuid[],
  p_description text default '',
  p_due_at timestamptz default null,
  p_priority public.task_priority default 'none',
  p_assignee_id uuid default null,
  p_due_timezone text default null,
  p_kind public.task_kind default 'todo'
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_task public.tasks;
  label_id uuid;
  creator_id uuid := (select auth.uid());
begin
  foreach label_id in array coalesce(p_label_ids, array[]::uuid[]) loop
    if anttodo_private.label_permission_level(label_id) < 2
      or not exists (
        select 1
        from public.labels
        where id = label_id
          and workspace_id = p_workspace_id
      ) then
      raise exception 'Insufficient label permission';
    end if;
  end loop;

  created_task.id := extensions.gen_random_uuid();

  insert into public.tasks (
    id,
    workspace_id,
    title,
    description,
    due_at,
    due_timezone,
    priority,
    kind,
    assignee_id,
    created_by
  ) values (
    created_task.id,
    p_workspace_id,
    p_title,
    coalesce(p_description, ''),
    p_due_at,
    p_due_timezone,
    case when p_kind = 'note' then 'none'::public.task_priority else p_priority end,
    p_kind,
    null,
    creator_id
  );

  insert into public.task_labels (task_id, label_id)
  select created_task.id, unnest(coalesce(p_label_ids, array[]::uuid[]));

  if p_assignee_id is not null then
    update public.tasks
    set assignee_id = p_assignee_id
    where id = created_task.id;
  end if;

  -- When the creator is not self-assigned, watch the task as a participant.
  if p_assignee_id is distinct from creator_id then
    insert into public.task_participants (task_id, user_id)
    values (created_task.id, creator_id);
  end if;

  select *
  into created_task
  from public.tasks
  where tasks.id = created_task.id;

  insert into public.activity_events (
    workspace_id,
    task_id,
    actor_id,
    event_type
  ) values (
    p_workspace_id,
    created_task.id,
    creator_id,
    'task.created'
  );

  return created_task;
end;
$$;

create or replace function public.list_label_task_counts(p_workspace_id uuid)
returns table(label_id uuid, task_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not anttodo_private.is_workspace_member(p_workspace_id) then
    raise exception 'not authorized';
  end if;

  return query
  select label.id, coalesce(counts.task_count, 0)
  from public.labels label
  left join anttodo_private.label_task_counts counts on counts.label_id = label.id
  where label.workspace_id = p_workspace_id
    and anttodo_private.label_permission_level(label.id) >= 1;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'labels'
      and column_name = 'is_system'
  ) then
    -- Preserve any normal labels that users nested below a generated user-space
    -- label. Only the generated label itself and its task associations belong to
    -- the cancelled feature.
    update public.labels child
    set
      parent_id = system_label.parent_id,
      inherit_permissions = system_label.parent_id is not null
    from public.labels system_label
    where child.parent_id = system_label.id
      and system_label.is_system
      and not child.is_system;

    -- Remove task associations explicitly while the label still exists. The FK
    -- also cascades, but the explicit delete keeps the cleanup intent auditable
    -- and lets the existing task-label triggers refresh task versions/counts.
    delete from public.task_labels task_label
    using public.labels system_label
    where task_label.label_id = system_label.id
      and system_label.is_system;

    delete from public.labels where is_system;
  end if;
end;
$$;

drop policy if exists labels_insert on public.labels;
create policy labels_insert on public.labels for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
  and (
    parent_id is null
    or (select anttodo_private.label_permission_level(parent_id)) >= 2
  )
);

alter policy labels_update on public.labels
using ((select anttodo_private.label_permission_level(id)) >= 2)
with check (
  (select anttodo_private.is_workspace_member(workspace_id))
  and (
    parent_id is null
    or (select anttodo_private.label_permission_level(parent_id)) >= 2
  )
);

alter policy labels_delete
on public.labels
using ((select anttodo_private.label_permission_level(id)) >= 2);

alter policy task_labels_insert
on public.task_labels
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (
    (select anttodo_private.is_task_creator(task_id))
    or (select anttodo_private.can_organize_task(task_id))
  )
);

alter table public.labels drop constraint if exists labels_system_owner_check;
alter table public.labels drop constraint if exists labels_owner_user_id_fkey;
drop index if exists public.labels_user_space_owner_uidx;
drop index if exists public.labels_workspace_parent_name_user_uidx;

alter table public.labels drop column if exists is_system;
alter table public.labels drop column if exists owner_user_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.labels'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(workspace_id, parent_id, name)%'
  ) and not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'labels'
      and indexdef ilike '%unique%'
      and indexdef like '%workspace_id%'
      and indexdef like '%parent_id%'
      and indexdef like '%name%'
  ) then
    alter table public.labels
      add constraint labels_workspace_id_parent_id_name_key
      unique (workspace_id, parent_id, name);
  end if;
end;
$$;
