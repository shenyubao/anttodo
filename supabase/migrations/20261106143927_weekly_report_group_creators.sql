-- Historical groups have no reliably recorded creator. Add the default only
-- after adding the nullable column so migration callers never own old groups.
alter table public.weekly_report_groups
  add column created_by uuid references auth.users(id) on delete set null;
alter table public.weekly_report_groups alter column created_by set default auth.uid();
create index weekly_report_groups_creator_idx on public.weekly_report_groups(created_by)
  where created_by is not null;

-- All user-facing RPCs are SECURITY INVOKER. Trusted maintenance (including
-- auth.users ON DELETE SET NULL) may clear attribution; clients cannot transfer it.
create function anttodo_private.protect_weekly_report_group_creator()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if current_user in ('authenticated','anon') and new.created_by is not null
      and new.created_by is distinct from auth.uid() then
      raise exception '周报组创建者必须为当前用户' using errcode='23514';
    end if;
    new.created_by := coalesce(auth.uid(),new.created_by);
  elsif new.created_by is distinct from old.created_by and current_user in ('authenticated','anon') then
    raise exception '周报组创建者不可修改' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function anttodo_private.protect_weekly_report_group_creator() from public,anon,authenticated;
create trigger weekly_report_groups_protect_creator before insert or update on public.weekly_report_groups
  for each row execute function anttodo_private.protect_weekly_report_group_creator();

-- Private definer lookup avoids recursive group RLS; membership is always live.
create function anttodo_private.can_manage_weekly_report_group(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.weekly_report_groups g where g.id=target_group
      and anttodo_private.is_workspace_member(g.workspace_id)
      and (g.created_by=(select auth.uid()) or anttodo_private.is_workspace_admin(g.workspace_id))
  );
$$;
revoke all on function anttodo_private.can_manage_weekly_report_group(uuid) from public,anon;
grant execute on function anttodo_private.can_manage_weekly_report_group(uuid) to authenticated;

create or replace function anttodo_private.can_read_weekly_report_group(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.weekly_report_groups g
    where g.id=target_group and anttodo_private.is_workspace_member(g.workspace_id)
      and (g.visibility='workspace' or anttodo_private.can_manage_weekly_report_group(g.id)
        or (select auth.uid())=any(g.participant_ids) or (select auth.uid())=any(g.viewer_user_ids)
        or exists (select 1 from public.user_group_members m where m.workspace_id=g.workspace_id
          and m.group_id=any(g.viewer_group_ids) and m.user_id=(select auth.uid())))
  );
$$;

-- INSERT ... RETURNING checks SELECT against the new row before a stable
-- lookup helper can see it. Check creator identity directly on the row here.
drop policy group_read on public.weekly_report_groups;
create policy group_read on public.weekly_report_groups for select to authenticated
  using ((select anttodo_private.is_workspace_member(workspace_id))
    and (created_by=(select auth.uid()) or (select anttodo_private.can_access_weekly_report_group(id))));

drop policy group_create on public.weekly_report_groups;
create policy group_create on public.weekly_report_groups for insert to authenticated
  with check ((select anttodo_private.is_workspace_member(workspace_id))
    and created_by=(select auth.uid()) and not is_default);
drop policy group_update on public.weekly_report_groups;
create policy group_update on public.weekly_report_groups for update to authenticated
  using ((select anttodo_private.can_manage_weekly_report_group(id)))
  with check ((select anttodo_private.can_manage_weekly_report_group(id)));
drop policy group_delete on public.weekly_report_groups;
create policy group_delete on public.weekly_report_groups for delete to authenticated
  using ((select anttodo_private.can_manage_weekly_report_group(id)));

create or replace function public.save_weekly_report_group(p_workspace_id uuid,p_name text,p_participant_ids uuid[],
  p_visibility text default 'workspace',p_viewer_user_ids uuid[] default '{}',p_viewer_group_ids uuid[] default '{}',
  p_enabled boolean default false,p_schedules jsonb default '[]',p_notification_group_ids uuid[] default '{}',p_id uuid default null,
  p_participant_mode text default null,p_participant_group_ids uuid[] default null)
returns public.weekly_report_groups language plpgsql security invoker set search_path = '' as $$
declare saved public.weekly_report_groups; source_mode text; source_groups uuid[];
begin
  if not coalesce(anttodo_private.is_workspace_member(p_workspace_id),false) then
    raise exception '只有当前团队空间成员可以创建周报组' using errcode='42501';
  end if;
  if p_id is not null then
    select * into saved from public.weekly_report_groups where id=p_id and workspace_id=p_workspace_id for update;
    if not found or not coalesce(anttodo_private.can_manage_weekly_report_group(p_id),false) then
      raise exception '周报组不存在或无权配置，只有创建者、所有者和管理员可以修改' using errcode='42501';
    end if;
  end if;
  -- Omitted source fields preserve group associations for older clients.
  source_mode := coalesce(p_participant_mode,saved.participant_mode,'users');
  source_groups := case when source_mode='groups' then coalesce(p_participant_group_ids,saved.participant_group_ids,'{}') else '{}'::uuid[] end;
  if p_id is null then
    insert into public.weekly_report_groups(workspace_id,name,participant_ids,participant_mode,participant_group_ids,visibility,viewer_user_ids,viewer_group_ids,
      enabled,schedules,notification_group_ids)
    values(p_workspace_id,p_name,p_participant_ids,source_mode,source_groups,p_visibility,p_viewer_user_ids,p_viewer_group_ids,
      p_enabled,p_schedules,p_notification_group_ids) returning * into saved;
  else
    update public.weekly_report_groups set name=p_name,participant_ids=p_participant_ids,participant_mode=source_mode,participant_group_ids=source_groups,visibility=p_visibility,
      viewer_user_ids=p_viewer_user_ids,viewer_group_ids=p_viewer_group_ids,enabled=p_enabled,schedules=p_schedules,
      notification_group_ids=p_notification_group_ids where id=p_id and workspace_id=p_workspace_id returning * into saved;
    if saved.id is null then raise exception '周报组不存在或无权配置' using errcode='42501'; end if;
  end if;
  return saved;
end;
$$;

create or replace function public.delete_weekly_report_group(p_workspace_id uuid,p_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare deleted_id uuid;
begin
  if not coalesce(anttodo_private.is_workspace_member(p_workspace_id),false)
    or not coalesce(anttodo_private.can_manage_weekly_report_group(p_id),false) then
    raise exception '只有周报组创建者、团队空间所有者和管理员可以删除周报组' using errcode='42501';
  end if;
  delete from public.weekly_report_groups where id=p_id and workspace_id=p_workspace_id returning id into deleted_id;
  if deleted_id is null then
    raise exception '周报组不存在或无权删除，请刷新后重试' using errcode='42501';
  end if;
  return deleted_id;
end;
$$;

create or replace function public.save_weekly_report_participants(p_workspace_id uuid,p_user_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(anttodo_private.can_manage_weekly_report_group(anttodo_private.default_weekly_report_group(p_workspace_id)),false) then
    raise exception '只有周报组创建者、团队空间所有者和管理员可以修改人员配置' using errcode='42501';
  end if;
  update public.weekly_report_groups set participant_ids=coalesce(p_user_ids,'{}')
    where id=anttodo_private.default_weekly_report_group(p_workspace_id);
  return public.get_weekly_report_configuration(p_workspace_id);
end;
$$;
create or replace function public.save_weekly_report_reminders(p_workspace_id uuid,p_enabled boolean,p_schedules jsonb,p_group_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(anttodo_private.can_manage_weekly_report_group(anttodo_private.default_weekly_report_group(p_workspace_id)),false) then
    raise exception '只有周报组创建者、团队空间所有者和管理员可以修改提醒配置' using errcode='42501';
  end if;
  update public.weekly_report_groups set enabled=p_enabled,schedules=p_schedules,
    notification_group_ids=coalesce(p_group_ids,'{}')
    where id=anttodo_private.default_weekly_report_group(p_workspace_id);
  return public.get_weekly_report_configuration(p_workspace_id);
end;
$$;
notify pgrst, 'reload schema';
