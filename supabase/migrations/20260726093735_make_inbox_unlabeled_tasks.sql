create or replace function anttodo_private.on_workspace_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create or replace function anttodo_private.can_view_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.tasks t
      where t.id = target_task
        and anttodo_private.is_workspace_member(t.workspace_id)
    )
    and not exists (
      select 1
      from public.task_labels tl
      where tl.task_id = target_task
        and anttodo_private.label_permission_level(tl.label_id) < 1
    );
$$;

create or replace function anttodo_private.can_edit_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.tasks t
      where t.id = target_task
        and (
          exists (
            select 1
            from public.task_labels tl
            where tl.task_id = t.id
          )
          or t.created_by = (select auth.uid())
          or anttodo_private.is_workspace_admin(t.workspace_id)
        )
    )
    and not exists (
      select 1
      from public.task_labels tl
      where tl.task_id = target_task
        and anttodo_private.label_permission_level(tl.label_id) < 2
    );
$$;

create or replace function public.create_task_with_labels(
  p_workspace_id uuid,
  p_title text,
  p_label_ids uuid[],
  p_description text default '',
  p_due_at timestamptz default null,
  p_priority public.task_priority default 'none',
  p_assignee_id uuid default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_task public.tasks;
  label_id uuid;
begin
  foreach label_id in array coalesce(p_label_ids, array[]::uuid[]) loop
    if anttodo_private.label_permission_level(label_id) < 2
      or not exists (
        select 1 from public.labels
        where id = label_id
          and workspace_id = p_workspace_id
      ) then
      raise exception 'Insufficient label permission';
    end if;
  end loop;

  created_task.id := extensions.gen_random_uuid();

  insert into public.tasks (
    id, workspace_id, title, description, due_at, priority, assignee_id, created_by
  ) values (
    created_task.id, p_workspace_id, p_title, coalesce(p_description, ''),
    p_due_at, p_priority, p_assignee_id, (select auth.uid())
  );

  insert into public.task_labels (task_id, label_id)
  select created_task.id, unnest(coalesce(p_label_ids, array[]::uuid[]));

  select *
  into created_task
  from public.tasks
  where tasks.id = created_task.id;

  insert into public.activity_events (workspace_id, task_id, actor_id, event_type)
  values (p_workspace_id, created_task.id, (select auth.uid()), 'task.created');

  return created_task;
end;
$$;

create or replace function anttodo_private.move_label_to_inbox_impl(
  p_source_label uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_label public.labels%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception '需要登录后才能移动标签' using errcode = '42501';
  end if;

  select *
  into source_label
  from public.labels
  where id = p_source_label;

  if not found then
    raise exception '当前标签不存在或不能移至收集箱';
  end if;

  if anttodo_private.label_permission_level(source_label.id) < 2 then
    raise exception '没有移动此标签的权限' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.labels child
    where child.parent_id = source_label.id
      and anttodo_private.label_permission_level(child.id) < 2
  ) then
    raise exception '没有移动部分子标签的权限' using errcode = '42501';
  end if;

  update public.labels
  set
    parent_id = null,
    inherit_permissions = false
  where parent_id = source_label.id;

  delete from public.labels
  where id = source_label.id;
end;
$$;

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
  where id = source_label;

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

alter policy labels_delete
on public.labels
using ((select anttodo_private.label_permission_level(id)) >= 2);

update public.labels
set
  parent_id = null,
  inherit_permissions = false
where parent_id in (
  select id
  from public.labels
  where is_system
);

delete from public.labels
where is_system;

alter table public.labels
drop column is_system;
