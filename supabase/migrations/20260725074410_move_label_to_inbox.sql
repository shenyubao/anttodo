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
  inbox_label public.labels%rowtype;
  conflicting_child text;
begin
  if (select auth.uid()) is null then
    raise exception '需要登录后才能移动标签' using errcode = '42501';
  end if;

  select *
  into source_label
  from public.labels
  where id = p_source_label
    and not is_system;

  if not found then
    raise exception '当前标签不存在或不能移至收集箱';
  end if;

  select *
  into inbox_label
  from public.labels
  where workspace_id = source_label.workspace_id
    and is_system
  order by position, created_at
  limit 1;

  if not found then
    raise exception '当前团队空间缺少系统收集箱';
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

  select child.name
  into conflicting_child
  from public.labels child
  join public.labels existing
    on existing.parent_id = inbox_label.id
   and existing.name = child.name
   and existing.id <> child.id
  where child.parent_id = source_label.id
  limit 1;

  if conflicting_child is not null then
    raise exception '收集箱下已存在同名子标签：%', conflicting_child;
  end if;

  insert into public.task_labels (task_id, label_id)
  select task_id, inbox_label.id
  from public.task_labels
  where label_id = source_label.id
  on conflict do nothing;

  update public.labels
  set
    parent_id = inbox_label.id,
    inherit_permissions = true
  where parent_id = source_label.id;

  delete from public.labels
  where id = source_label.id;
end;
$$;

revoke all on function anttodo_private.move_label_to_inbox_impl(uuid)
from public, anon;
grant execute on function anttodo_private.move_label_to_inbox_impl(uuid)
to authenticated;

create or replace function public.move_label_to_inbox(
  p_source_label uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform anttodo_private.move_label_to_inbox_impl(p_source_label);
end;
$$;

revoke all on function public.move_label_to_inbox(uuid)
from public, anon;
grant execute on function public.move_label_to_inbox(uuid)
to authenticated;
