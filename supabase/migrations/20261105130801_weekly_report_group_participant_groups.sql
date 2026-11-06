-- Preserve participant_ids as the single effective roster consumed by permissions,
-- reports, reminder claims and older read clients.
alter table public.weekly_report_groups
  add column participant_mode text not null default 'users' check (participant_mode in ('users','groups')),
  add column participant_group_ids uuid[] not null default '{}';
create index weekly_report_groups_participant_groups_idx on public.weekly_report_groups
  using gin (participant_group_ids) where participant_mode='groups';

create function anttodo_private.weekly_report_group_members(target_workspace uuid,target_groups uuid[])
returns uuid[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(distinct m.user_id order by m.user_id),'{}'::uuid[])
  from public.user_group_members m
  join public.workspace_members w on w.workspace_id=m.workspace_id and w.user_id=m.user_id
  where m.workspace_id=target_workspace and m.group_id=any(target_groups);
$$;
revoke all on function anttodo_private.weekly_report_group_members(uuid,uuid[]) from public, anon;
grant execute on function anttodo_private.weekly_report_group_members(uuid,uuid[]) to authenticated, service_role;

create or replace function anttodo_private.validate_weekly_report_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.workspace_id<>old.workspace_id or new.is_default<>old.is_default) then
    raise exception 'Weekly report group identity fields cannot be changed' using errcode='23514';
  end if;
  if not anttodo_private.valid_weekly_report_schedules(new.schedules) then
    raise exception '周报提醒时间无效' using errcode='23514';
  end if;
  new.name := btrim(new.name);
  if new.participant_mode = 'groups' then
    if exists (select 1 from unnest(new.participant_group_ids) u
      where u is null or not exists (select 1 from public.user_groups g where g.workspace_id=new.workspace_id and g.id=u)) then
      raise exception '周报组配置只能选择当前团队空间的用户组' using errcode='23514';
    end if;
    new.participant_group_ids := array(select distinct u from unnest(new.participant_group_ids) u order by u);
    if tg_op='INSERT' and cardinality(new.participant_group_ids)=0 then
      raise exception '请选择至少一个用户组' using errcode='23514';
    end if;
    -- The submitted effective roster is never authoritative in group mode.
    new.participant_ids := anttodo_private.weekly_report_group_members(new.workspace_id,new.participant_group_ids);
  else
    new.participant_group_ids := '{}';
  end if;
  if tg_op='INSERT' and new.participant_mode='users' and cardinality(new.participant_ids)=0 then
    raise exception '请选择至少一名应填人员' using errcode='23514';
  end if;
  if exists (select 1 from unnest(new.participant_ids || new.viewer_user_ids) u
    where u is null or not exists (select 1 from public.workspace_members m where m.workspace_id=new.workspace_id and m.user_id=u))
    or exists (select 1 from unnest(new.viewer_group_ids) u
      where u is null or not exists (select 1 from public.user_groups g where g.workspace_id=new.workspace_id and g.id=u))
    or exists (select 1 from unnest(new.notification_group_ids) u
      where u is null or not exists (select 1 from public.weekly_report_notification_groups g where g.workspace_id=new.workspace_id and g.id=u)) then
    raise exception '周报组配置只能选择当前团队空间的人员、用户组和通知群' using errcode='23514';
  end if;
  new.participant_ids := array(select distinct u from unnest(new.participant_ids) u order by u);
  new.viewer_user_ids := array(select distinct u from unnest(new.viewer_user_ids) u order by u);
  new.viewer_group_ids := array(select distinct u from unnest(new.viewer_group_ids) u order by u);
  new.notification_group_ids := array(select distinct u from unnest(new.notification_group_ids) u order by u);
  new.schedules := (select coalesce(jsonb_agg(item order by item->>'day',item->>'time'), '[]')
    from (select distinct value item from jsonb_array_elements(new.schedules)) s);
  if cardinality(new.participant_ids)=0 then new.enabled:=false; end if;
  if tg_op='UPDATE' and (new.enabled is distinct from old.enabled or new.schedules is distinct from old.schedules
    or new.notification_group_ids is distinct from old.notification_group_ids) then
    new.reminders_updated_at:=now();
  end if;
  new.updated_at:=now();
  return new;
end;
$$;
-- Recompute from the final membership set, never the temporary empty set between
-- DELETE and INSERT in one save. Lock before reading to serialize overlapping groups.
-- This private trigger needs elevated rights for service-side/cascaded cleanup;
-- it is not an RPC and has no caller-supplied targets or direct EXECUTE grants.
create function anttodo_private.sync_weekly_report_group_members()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  item record;
  old_workspace uuid; new_workspace uuid;
  old_group uuid; new_group uuid;
  source_ids uuid[]; viewer_ids uuid[]; effective_ids uuid[];
begin
  if tg_op <> 'INSERT' then
    old_workspace := old.workspace_id;
    if tg_table_name='user_groups' then old_group := old.id; else old_group := old.group_id; end if;
  end if;
  if tg_op <> 'DELETE' then new_workspace := new.workspace_id; new_group := new.group_id; end if;
  for item in select g.id from public.weekly_report_groups g
    where (g.workspace_id=old_workspace and (g.participant_group_ids @> array[old_group]
        or (tg_table_name='user_groups' and old_group=any(g.viewer_group_ids))))
      or (g.workspace_id=new_workspace and g.participant_group_ids @> array[new_group])
    order by g.id for update
  loop
    -- Deletions of groups and their cascading memberships can enqueue triggers
    -- in either order. Clean both references before validating the effective row.
    select array(select id from public.user_groups where workspace_id=g.workspace_id and id=any(g.participant_group_ids) order by id),
      array(select id from public.user_groups where workspace_id=g.workspace_id and id=any(g.viewer_group_ids) order by id)
      into source_ids,viewer_ids from public.weekly_report_groups g where g.id=item.id;
    select case when g.participant_mode='groups' then anttodo_private.weekly_report_group_members(g.workspace_id,source_ids)
      else g.participant_ids end into effective_ids from public.weekly_report_groups g where g.id=item.id;
    update public.weekly_report_groups set participant_ids=effective_ids,participant_group_ids=source_ids,viewer_group_ids=viewer_ids
      where id=item.id and (participant_ids is distinct from effective_ids or participant_group_ids is distinct from source_ids
        or viewer_group_ids is distinct from viewer_ids);
  end loop;
  return null;
end;
$$;
revoke all on function anttodo_private.sync_weekly_report_group_members() from public, anon, authenticated;
create constraint trigger weekly_report_groups_sync_members
  after insert or update or delete on public.user_group_members
  deferrable initially deferred for each row execute function anttodo_private.sync_weekly_report_group_members();
-- Group deletion also waits for the transaction's final roster; this includes
-- deleting an empty source, which produces no cascading membership events.
drop trigger weekly_report_groups_user_group_removed on public.user_groups;
create constraint trigger weekly_report_groups_user_group_removed
  after delete on public.user_groups
  deferrable initially deferred for each row execute function anttodo_private.sync_weekly_report_group_members();

-- Replace, rather than overload, so PostgREST resolves old and new named calls.
drop function public.save_weekly_report_group(uuid,text,uuid[],text,uuid[],uuid[],boolean,jsonb,uuid[],uuid);
create function public.save_weekly_report_group(p_workspace_id uuid,p_name text,p_participant_ids uuid[],
  p_visibility text default 'workspace',p_viewer_user_ids uuid[] default '{}',p_viewer_group_ids uuid[] default '{}',
  p_enabled boolean default false,p_schedules jsonb default '[]',p_notification_group_ids uuid[] default '{}',p_id uuid default null,
  p_participant_mode text default null,p_participant_group_ids uuid[] default null)
returns public.weekly_report_groups language plpgsql security invoker set search_path = '' as $$
declare saved public.weekly_report_groups; source_mode text; source_groups uuid[];
begin
  if not coalesce(anttodo_private.is_workspace_admin(p_workspace_id),false) then
    raise exception '只有团队空间所有者和管理员可以配置周报组' using errcode='42501';
  end if;
  if p_id is not null then
    select * into saved from public.weekly_report_groups where id=p_id and workspace_id=p_workspace_id for update;
    if not found then raise exception '周报组不存在或无权配置' using errcode='42501'; end if;
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

revoke all on function public.save_weekly_report_group(uuid,text,uuid[],text,uuid[],uuid[],boolean,jsonb,uuid[],uuid,text,uuid[]) from public, anon;
grant execute on function public.save_weekly_report_group(uuid,text,uuid[],text,uuid[],uuid[],boolean,jsonb,uuid[],uuid,text,uuid[]) to authenticated;

notify pgrst, 'reload schema';
