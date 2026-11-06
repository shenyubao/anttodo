-- Deleting a group is an explicit workspace-admin operation. Its reports and
-- report-owned ACLs / notification deliveries follow the existing FK cascades.
alter table public.weekly_reports
  drop constraint weekly_reports_weekly_report_group_id_workspace_id_fkey,
  add constraint weekly_reports_weekly_report_group_id_workspace_id_fkey
    foreign key (weekly_report_group_id,workspace_id)
    references public.weekly_report_groups(id,workspace_id) on delete cascade;

grant delete on public.weekly_report_groups to authenticated;
create policy group_delete on public.weekly_report_groups for delete to authenticated
  using ((select anttodo_private.is_workspace_admin(workspace_id)));

create function public.delete_weekly_report_group(p_workspace_id uuid,p_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare deleted_id uuid;
begin
  if auth.uid() is null or not coalesce(anttodo_private.is_workspace_admin(p_workspace_id),false) then
    raise exception '只有团队空间所有者和管理员可以删除周报组' using errcode='42501';
  end if;
  delete from public.weekly_report_groups where id=p_id and workspace_id=p_workspace_id returning id into deleted_id;
  if deleted_id is null then
    raise exception '周报组不存在或无权删除，请刷新后重试' using errcode='42501';
  end if;
  return deleted_id;
end;
$$;
revoke all on function public.delete_weekly_report_group(uuid,uuid) from public,anon;
grant execute on function public.delete_weekly_report_group(uuid,uuid) to authenticated;

-- The original default is deletable too. Legacy APIs select the same surviving
-- fallback as the current client; deleting the last group leaves an empty state.
create or replace function anttodo_private.default_weekly_report_group(target_workspace uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select id from public.weekly_report_groups where workspace_id=target_workspace
    order by is_default desc,created_at,id limit 1;
$$;
create or replace function anttodo_private.can_write_weekly_report(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select anttodo_private.can_write_group_weekly_report(target_workspace,
    anttodo_private.default_weekly_report_group(target_workspace));
$$;
create or replace function public.get_weekly_report_configuration(p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('participant_ids',participant_ids,'enabled',enabled,'schedules',schedules,
    'notification_group_ids',notification_group_ids) from public.weekly_report_groups
    where id=anttodo_private.default_weekly_report_group(p_workspace_id);
$$;
create or replace function public.save_weekly_report_participants(p_workspace_id uuid,p_user_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(anttodo_private.is_workspace_admin(p_workspace_id),false) then
    raise exception '只有团队空间所有者和管理员可以修改人员配置' using errcode='42501';
  end if;
  update public.weekly_report_groups set participant_ids=coalesce(p_user_ids,'{}')
    where id=anttodo_private.default_weekly_report_group(p_workspace_id);
  return public.get_weekly_report_configuration(p_workspace_id);
end;
$$;
create or replace function public.save_weekly_report_reminders(p_workspace_id uuid,p_enabled boolean,p_schedules jsonb,p_group_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(anttodo_private.is_workspace_admin(p_workspace_id),false) then
    raise exception '只有团队空间所有者和管理员可以修改提醒配置' using errcode='42501';
  end if;
  update public.weekly_report_groups set enabled=p_enabled,schedules=p_schedules,
    notification_group_ids=coalesce(p_group_ids,'{}')
    where id=anttodo_private.default_weekly_report_group(p_workspace_id);
  return public.get_weekly_report_configuration(p_workspace_id);
end;
$$;
notify pgrst, 'reload schema';
