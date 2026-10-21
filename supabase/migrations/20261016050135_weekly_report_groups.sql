-- Weekly report groups own their roster, audience and reminder configuration.
create table public.weekly_report_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  is_default boolean not null default false,
  participant_ids uuid[] not null default '{}',
  visibility text not null default 'workspace' check (visibility in ('workspace', 'selected')),
  viewer_user_ids uuid[] not null default '{}',
  viewer_group_ids uuid[] not null default '{}',
  enabled boolean not null default false,
  schedules jsonb not null default '[]' check (anttodo_private.valid_weekly_report_schedules(schedules)),
  notification_group_ids uuid[] not null default '{}',
  reminders_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (not enabled or (cardinality(participant_ids) > 0 and jsonb_array_length(schedules) > 0
    and cardinality(notification_group_ids) > 0))
);
create unique index weekly_report_groups_default_idx on public.weekly_report_groups(workspace_id) where is_default;
create index weekly_report_groups_workspace_idx on public.weekly_report_groups(workspace_id, created_at, id);
insert into public.weekly_report_groups(workspace_id, name, is_default, participant_ids, enabled,
  schedules, notification_group_ids, reminders_updated_at)
select w.id, '默认周报组', true,
  coalesce((select array_agg(p.user_id order by p.user_id) from public.weekly_report_participants p where p.workspace_id=w.id), '{}'),
  coalesce(s.enabled, false), coalesce(s.schedules, '[]'),
  coalesce((select array_agg(g.notification_group_id order by g.notification_group_id)
    from public.weekly_report_reminder_groups g where g.workspace_id=w.id), '{}'),
  coalesce(s.reminders_updated_at, now())
from public.workspaces w left join public.weekly_report_settings s on s.workspace_id=w.id;

alter table public.weekly_reports add column weekly_report_group_id uuid;
-- The old immutability trigger permits backfilling the new field. Preserve historical update times.
alter table public.weekly_reports disable trigger weekly_reports_updated_at;
update public.weekly_reports r set weekly_report_group_id=g.id
from public.weekly_report_groups g where g.workspace_id=r.workspace_id and g.is_default;
alter table public.weekly_reports enable trigger weekly_reports_updated_at;
alter table public.weekly_reports alter column weekly_report_group_id set not null;
alter table public.weekly_reports add foreign key (weekly_report_group_id, workspace_id)
  references public.weekly_report_groups(id, workspace_id);
alter table public.weekly_reports drop constraint weekly_reports_workspace_id_author_id_week_start_key;
alter table public.weekly_reports add unique (workspace_id, weekly_report_group_id, author_id, week_start);
create index weekly_reports_group_week_idx on public.weekly_reports(workspace_id, weekly_report_group_id, week_start, updated_at desc);

create function anttodo_private.default_weekly_report_group(target_workspace uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select id from public.weekly_report_groups where workspace_id=target_workspace and is_default;
$$;
create or replace function anttodo_private.initialize_weekly_report_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.weekly_report_groups(workspace_id, name, is_default, participant_ids)
    select new.workspace_id, '默认周报组', true, array[new.user_id]
    from public.workspaces w where w.id=new.workspace_id and w.created_by=new.user_id
    on conflict do nothing;
  return new;
end;
$$;

create function anttodo_private.can_read_weekly_report_group(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.weekly_report_groups g
    where g.id=target_group and anttodo_private.is_workspace_member(g.workspace_id)
      and (g.visibility='workspace' or anttodo_private.is_workspace_admin(g.workspace_id)
        or (select auth.uid())=any(g.participant_ids) or (select auth.uid())=any(g.viewer_user_ids)
        or exists (select 1 from public.user_group_members m where m.workspace_id=g.workspace_id
          and m.group_id=any(g.viewer_group_ids) and m.user_id=(select auth.uid())))
  );
$$;
create function anttodo_private.can_access_weekly_report_group(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select anttodo_private.can_read_weekly_report_group(target_group) or exists (
    select 1 from public.weekly_reports r where r.weekly_report_group_id=target_group
      and r.author_id=(select auth.uid()) and anttodo_private.is_workspace_member(r.workspace_id)
  );
$$;
create function anttodo_private.can_write_group_weekly_report(target_workspace uuid, target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.weekly_report_groups g where g.id=target_group and g.workspace_id=target_workspace
      and (select auth.uid())=any(g.participant_ids) and anttodo_private.is_workspace_member(g.workspace_id)
  );
$$;
create or replace function anttodo_private.can_write_weekly_report(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.weekly_report_groups g where g.workspace_id=target_workspace and g.is_default
    and anttodo_private.can_write_group_weekly_report(g.workspace_id, g.id));
$$;
create function anttodo_private.can_write_weekly_report_by_id(target_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.weekly_reports r where r.id=target_report
    and r.author_id=(select auth.uid())
    and anttodo_private.can_write_group_weekly_report(r.workspace_id,r.weekly_report_group_id));
$$;
create or replace function anttodo_private.can_view_weekly_report(target_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.weekly_reports r where r.id=target_report
      and anttodo_private.is_workspace_member(r.workspace_id)
      and (r.author_id=(select auth.uid()) or (r.status='published'
        and anttodo_private.can_read_weekly_report_group(r.weekly_report_group_id)))
  );
$$;
create or replace function anttodo_private.weekly_report_identity_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.author_id<>old.author_id
    or new.week_start<>old.week_start or new.weekly_report_group_id<>old.weekly_report_group_id then
    raise exception 'Weekly report identity fields cannot be changed' using errcode='23514';
  end if;
  return new;
end;
$$;
create function anttodo_private.fill_weekly_report_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.weekly_report_group_id := coalesce(new.weekly_report_group_id, anttodo_private.default_weekly_report_group(new.workspace_id));
  return new;
end;
$$;
create trigger weekly_reports_default_group before insert on public.weekly_reports
for each row execute function anttodo_private.fill_weekly_report_group();

alter table public.weekly_report_groups enable row level security;
revoke all on public.weekly_report_groups from public, anon, authenticated;
grant select, insert, update on public.weekly_report_groups to authenticated;
grant all on public.weekly_report_groups to service_role;
create policy group_read on public.weekly_report_groups for select to authenticated
  using ((select anttodo_private.is_workspace_admin(workspace_id)) or (select anttodo_private.can_access_weekly_report_group(id)));
create policy group_create on public.weekly_report_groups for insert to authenticated
  with check ((select anttodo_private.is_workspace_admin(workspace_id)) and not is_default);
create policy group_update on public.weekly_report_groups for update to authenticated
  using ((select anttodo_private.is_workspace_admin(workspace_id)))
  with check ((select anttodo_private.is_workspace_admin(workspace_id)));
alter publication supabase_realtime add table public.weekly_report_groups;
create trigger weekly_report_groups_touch_revision after insert or update or delete on public.weekly_report_groups
for each row execute function anttodo_private.touch_weekly_report_access_revision_trigger();

create function anttodo_private.validate_weekly_report_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.workspace_id<>old.workspace_id or new.is_default<>old.is_default) then
    raise exception 'Weekly report group identity fields cannot be changed' using errcode='23514';
  end if;
  if not anttodo_private.valid_weekly_report_schedules(new.schedules) then
    raise exception '周报提醒时间无效' using errcode='23514';
  end if;
  new.name := btrim(new.name);
  if tg_op='INSERT' and cardinality(new.participant_ids)=0 then
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
create trigger validate_weekly_report_group before insert or update on public.weekly_report_groups
for each row execute function anttodo_private.validate_weekly_report_group();

-- Array references are checked for every write, and removed on source deletion.
create function anttodo_private.clean_weekly_report_group_subjects()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='workspace_members' then
    update public.weekly_report_groups set participant_ids=array(select u from unnest(participant_ids) u
        where exists(select 1 from public.workspace_members m where m.workspace_id=old.workspace_id and m.user_id=u)),
      viewer_user_ids=array(select u from unnest(viewer_user_ids) u
        where exists(select 1 from public.workspace_members m where m.workspace_id=old.workspace_id and m.user_id=u))
      where workspace_id=old.workspace_id and (old.user_id=any(participant_ids) or old.user_id=any(viewer_user_ids));
  elsif tg_table_name='user_groups' then
    update public.weekly_report_groups set viewer_group_ids=array_remove(viewer_group_ids,old.id)
      where workspace_id=old.workspace_id and old.id=any(viewer_group_ids);
  else
    update public.weekly_report_groups set notification_group_ids=array_remove(notification_group_ids,old.id),
      enabled=enabled and cardinality(array_remove(notification_group_ids,old.id))>0
      where workspace_id=old.workspace_id and old.id=any(notification_group_ids);
  end if;
  return old;
end;
$$;
create trigger weekly_report_groups_member_removed after delete on public.workspace_members
for each row execute function anttodo_private.clean_weekly_report_group_subjects();
create trigger weekly_report_groups_user_group_removed after delete on public.user_groups
for each row execute function anttodo_private.clean_weekly_report_group_subjects();
create trigger weekly_report_groups_notification_group_removed after delete on public.weekly_report_notification_groups
for each row execute function anttodo_private.clean_weekly_report_group_subjects();

-- Replace workspace-wide restrictive write policies with report-group checks.
do $$ declare t text; predicate text; begin
  foreach t in array array['weekly_reports','weekly_report_user_acl','weekly_report_group_acl',
    'weekly_report_notification_targets','weekly_report_notification_deliveries'] loop
    execute format('drop policy weekly_report_roster_insert on public.%I',t);
    execute format('drop policy weekly_report_roster_update on public.%I',t);
    execute format('drop policy weekly_report_roster_delete on public.%I',t);
    predicate := case when t='weekly_reports'
      then 'anttodo_private.can_write_group_weekly_report(workspace_id,weekly_report_group_id)'
      else 'anttodo_private.can_write_weekly_report_by_id(report_id)' end;
    execute format('create policy weekly_report_roster_insert on public.%I as restrictive for insert to authenticated with check (%s)',t,predicate);
    execute format('create policy weekly_report_roster_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)',t,predicate,predicate);
    execute format('create policy weekly_report_roster_delete on public.%I as restrictive for delete to authenticated using (%s)',t,predicate);
  end loop;
end $$;

create function public.list_weekly_report_groups(p_workspace_id uuid)
returns setof jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(g) || jsonb_build_object('can_view_published',anttodo_private.can_read_weekly_report_group(g.id))
  from public.weekly_report_groups g where workspace_id=p_workspace_id order by is_default desc,created_at,id;
$$;
create function public.save_weekly_report_group(p_workspace_id uuid,p_name text,p_participant_ids uuid[],
  p_visibility text default 'workspace',p_viewer_user_ids uuid[] default '{}',p_viewer_group_ids uuid[] default '{}',
  p_enabled boolean default false,p_schedules jsonb default '[]',p_notification_group_ids uuid[] default '{}',p_id uuid default null)
returns public.weekly_report_groups language plpgsql security invoker set search_path = '' as $$
declare saved public.weekly_report_groups;
begin
  if not coalesce(anttodo_private.is_workspace_admin(p_workspace_id),false) then
    raise exception '只有团队空间所有者和管理员可以配置周报组' using errcode='42501';
  end if;
  if p_id is null then
    insert into public.weekly_report_groups(workspace_id,name,participant_ids,visibility,viewer_user_ids,viewer_group_ids,
      enabled,schedules,notification_group_ids)
    values(p_workspace_id,p_name,p_participant_ids,p_visibility,p_viewer_user_ids,p_viewer_group_ids,
      p_enabled,p_schedules,p_notification_group_ids) returning * into saved;
  else
    update public.weekly_report_groups set name=p_name,participant_ids=p_participant_ids,visibility=p_visibility,
      viewer_user_ids=p_viewer_user_ids,viewer_group_ids=p_viewer_group_ids,enabled=p_enabled,schedules=p_schedules,
      notification_group_ids=p_notification_group_ids where id=p_id and workspace_id=p_workspace_id returning * into saved;
    if saved.id is null then raise exception '周报组不存在或无权配置' using errcode='42501'; end if;
  end if;
  return saved;
end;
$$;

-- Legacy clients configure only the default group. Retired tables are no longer writable.
revoke insert,update,delete on public.weekly_report_settings,public.weekly_report_participants,
  public.weekly_report_reminder_groups from authenticated;
create or replace function public.get_weekly_report_configuration(p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('participant_ids',participant_ids,'enabled',enabled,'schedules',schedules,
    'notification_group_ids',notification_group_ids) from public.weekly_report_groups
    where workspace_id=p_workspace_id and is_default;
$$;
create or replace function public.save_weekly_report_participants(p_workspace_id uuid,p_user_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(anttodo_private.is_workspace_admin(p_workspace_id),false) then
    raise exception '只有团队空间所有者和管理员可以修改人员配置' using errcode='42501';
  end if;
  update public.weekly_report_groups set participant_ids=coalesce(p_user_ids,'{}') where workspace_id=p_workspace_id and is_default;
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
    notification_group_ids=coalesce(p_group_ids,'{}') where workspace_id=p_workspace_id and is_default;
  return public.get_weekly_report_configuration(p_workspace_id);
end;
$$;

create or replace function public.save_group_weekly_report(
  p_weekly_report_group_id uuid,
  p_workspace_id uuid,
  p_week_start date,
  p_completed_text text,
  p_next_plan_text text,
  p_reflection_text text,
  p_visibility public.weekly_report_visibility,
  p_user_ids uuid[] default '{}',
  p_group_ids uuid[] default '{}',
  p_report_id uuid default null,
  p_publish boolean default false,
  p_notification_group_ids uuid[] default '{}',
  p_okr_progress_text text default null
)
returns public.weekly_reports
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_report public.weekly_reports;
  clean_okr_progress_text text;
  saved_report public.weekly_reports;
  target_status public.weekly_report_status;
  clean_user_ids uuid[];
  clean_group_ids uuid[];
  clean_notification_group_ids uuid[];
  current_user_ids uuid[] := '{}'::uuid[];
  current_group_ids uuid[] := '{}'::uuid[];
  current_notification_group_ids uuid[] := '{}'::uuid[];
  material_change boolean := true;
  should_notify boolean := false;
  next_notification_revision bigint := 0;
begin
  -- Audience is inherited from the group; legacy per-report ACL arguments are ignored.
  p_visibility := 'workspace'; p_user_ids := '{}'; p_group_ids := '{}';
  perform 1 from public.weekly_report_groups where id=p_weekly_report_group_id and workspace_id=p_workspace_id for share;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_user_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_group_ids from unnest(coalesce(p_group_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_notification_group_ids
    from unnest(coalesce(p_notification_group_ids, '{}'::uuid[])) item;

  if (select auth.uid()) is null
    or not anttodo_private.can_write_group_weekly_report(p_workspace_id,p_weekly_report_group_id) then
    raise exception 'Weekly report workspace access denied' using errcode = '42501';
  end if;
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'Weekly report week must start on Monday' using errcode = '23514';
  end if;
  if p_visibility = 'workspace' and (cardinality(clean_user_ids) > 0 or cardinality(clean_group_ids) > 0) then
    raise exception 'Workspace visibility cannot include ACL subjects' using errcode = '23514';
  end if;
  if p_visibility = 'users' and cardinality(clean_group_ids) > 0 then
    raise exception 'User visibility cannot include groups' using errcode = '23514';
  end if;
  if p_visibility = 'groups' and cardinality(clean_user_ids) > 0 then
    raise exception 'Group visibility cannot include users' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(clean_notification_group_ids) selected_id
    where not exists (
      select 1 from public.weekly_report_notification_groups notification_group
      where notification_group.id = selected_id
        and notification_group.workspace_id = p_workspace_id
    )
  ) then
    raise exception 'Weekly report notification group access denied' using errcode = '42501';
  end if;

  if p_report_id is not null then
    select * into current_report from public.weekly_reports where id = p_report_id;
  else
    select * into current_report
    from public.weekly_reports
    where workspace_id = p_workspace_id
      and weekly_report_group_id = p_weekly_report_group_id
      and author_id = (select auth.uid())
      and week_start = p_week_start;
  end if;
  if p_report_id is not null and current_report.id is null then
    raise exception 'Weekly report access denied' using errcode='42501';
  end if;
  if current_report.id is not null and (
    current_report.author_id <> (select auth.uid())
    or current_report.workspace_id <> p_workspace_id
    or current_report.week_start <> p_week_start
    or current_report.weekly_report_group_id <> p_weekly_report_group_id
  ) then
    raise exception 'Only the weekly report author can update it' using errcode = '42501';
  end if;

  clean_okr_progress_text := coalesce(p_okr_progress_text, current_report.okr_progress_text, '');
  target_status := case
    when p_publish or current_report.status = 'published' then 'published'::public.weekly_report_status
    else 'draft'::public.weekly_report_status
  end;
  if target_status = 'published'
    and nullif(btrim(clean_okr_progress_text), '') is null
    and nullif(btrim(coalesce(p_completed_text, '')), '') is null
    and nullif(btrim(coalesce(p_next_plan_text, '')), '') is null
    and nullif(btrim(coalesce(p_reflection_text, '')), '') is null then
    raise exception 'Published weekly reports need content' using errcode = '23514';
  end if;
  if target_status = 'published' and p_visibility = 'users' and not exists (
    select 1 from unnest(clean_user_ids) subject_id
    where subject_id <> (select auth.uid())
  ) then
    raise exception 'Published user-visible reports need at least one user' using errcode = '23514';
  end if;
  if target_status = 'published' and p_visibility = 'groups' and cardinality(clean_group_ids) = 0 then
    raise exception 'Published group-visible reports need at least one group' using errcode = '23514';
  end if;

  if current_report.id is not null then
    select coalesce(array_agg(acl.user_id order by acl.user_id), '{}'::uuid[])
      into current_user_ids
    from public.weekly_report_user_acl acl where acl.report_id = current_report.id;
    select coalesce(array_agg(acl.group_id order by acl.group_id), '{}'::uuid[])
      into current_group_ids
    from public.weekly_report_group_acl acl where acl.report_id = current_report.id;
    select coalesce(array_agg(target.notification_group_id order by target.notification_group_id), '{}'::uuid[])
      into current_notification_group_ids
    from public.weekly_report_notification_targets target where target.report_id = current_report.id;

    material_change := current_report.okr_progress_text is distinct from clean_okr_progress_text
      or current_report.completed_text is distinct from coalesce(p_completed_text, '')
      or current_report.next_plan_text is distinct from coalesce(p_next_plan_text, '')
      or current_report.reflection_text is distinct from coalesce(p_reflection_text, '')
      or current_report.visibility is distinct from p_visibility
      or current_report.status is distinct from target_status
      or current_user_ids is distinct from (case when p_visibility = 'users' then clean_user_ids else '{}'::uuid[] end)
      or current_group_ids is distinct from (case when p_visibility = 'groups' then clean_group_ids else '{}'::uuid[] end)
      or current_notification_group_ids is distinct from clean_notification_group_ids;
  end if;

  should_notify := target_status = 'published'
    and (current_report.id is null or material_change);
  next_notification_revision := case
    when should_notify then coalesce(current_report.notification_revision, 0) + 1
    else coalesce(current_report.notification_revision, 0)
  end;

  if current_report.id is null then
    insert into public.weekly_reports (
      weekly_report_group_id, workspace_id, author_id, week_start, completed_text, next_plan_text,
      reflection_text, okr_progress_text, status, visibility, published_at, notification_revision
    ) values (
      p_weekly_report_group_id, p_workspace_id, (select auth.uid()), p_week_start,
      coalesce(p_completed_text, ''), coalesce(p_next_plan_text, ''),
      coalesce(p_reflection_text, ''), clean_okr_progress_text, target_status, p_visibility,
      case when target_status = 'published' then now() else null end,
      next_notification_revision
    ) returning * into saved_report;
  elsif material_change then
    update public.weekly_reports set
      okr_progress_text = clean_okr_progress_text,
      completed_text = coalesce(p_completed_text, ''),
      next_plan_text = coalesce(p_next_plan_text, ''),
      reflection_text = coalesce(p_reflection_text, ''),
      status = target_status,
      visibility = p_visibility,
      published_at = case
        when target_status = 'published' then coalesce(current_report.published_at, now())
        else null
      end,
      notification_revision = next_notification_revision
    where id = current_report.id
    returning * into saved_report;
  else
    saved_report := current_report;
  end if;

  if current_report.id is null
    or current_user_ids is distinct from (case when p_visibility = 'users' then clean_user_ids else '{}'::uuid[] end)
    or current_group_ids is distinct from (case when p_visibility = 'groups' then clean_group_ids else '{}'::uuid[] end) then
    delete from public.weekly_report_user_acl where report_id = saved_report.id;
    delete from public.weekly_report_group_acl where report_id = saved_report.id;
    if p_visibility = 'users' then
      insert into public.weekly_report_user_acl(report_id, workspace_id, user_id)
      select saved_report.id, saved_report.workspace_id, subject_id
      from unnest(clean_user_ids) subject_id
      where subject_id <> saved_report.author_id
      on conflict do nothing;
    elsif p_visibility = 'groups' then
      insert into public.weekly_report_group_acl(report_id, workspace_id, group_id)
      select saved_report.id, saved_report.workspace_id, subject_id
      from unnest(clean_group_ids) subject_id
      on conflict do nothing;
    end if;
  end if;

  if current_report.id is null
    or current_notification_group_ids is distinct from clean_notification_group_ids then
    delete from public.weekly_report_notification_targets where report_id = saved_report.id;
    insert into public.weekly_report_notification_targets(
      report_id, workspace_id, author_id, notification_group_id
    )
    select saved_report.id, saved_report.workspace_id, saved_report.author_id, selected_id
    from unnest(clean_notification_group_ids) selected_id
    on conflict do nothing;
  end if;

  if should_notify then
    update public.weekly_report_notification_deliveries
    set status = 'superseded', error_message = null
    where report_id = saved_report.id
      and revision < saved_report.notification_revision
      and status in ('pending', 'sending', 'failed');

    insert into public.weekly_report_notification_deliveries(
      report_id, workspace_id, author_id, notification_group_id, revision
    )
    select
      saved_report.id,
      saved_report.workspace_id,
      saved_report.author_id,
      selected_id,
      saved_report.notification_revision
    from unnest(clean_notification_group_ids) selected_id
    on conflict do nothing;
  end if;

  return saved_report;
end;
$$;

create or replace function public.save_weekly_report(
  p_workspace_id uuid,
  p_week_start date,
  p_completed_text text,
  p_next_plan_text text,
  p_reflection_text text,
  p_visibility public.weekly_report_visibility,
  p_user_ids uuid[] default '{}',
  p_group_ids uuid[] default '{}',
  p_report_id uuid default null,
  p_publish boolean default false,
  p_notification_group_ids uuid[] default '{}',
  p_okr_progress_text text default null
)
returns public.weekly_reports language plpgsql security invoker set search_path = '' as $$
declare target_group uuid;
begin
  if p_report_id is not null then
    select weekly_report_group_id into target_group from public.weekly_reports where id=p_report_id and workspace_id=p_workspace_id;
  else target_group:=anttodo_private.default_weekly_report_group(p_workspace_id); end if;
  return public.save_group_weekly_report(target_group,p_workspace_id,p_week_start,p_completed_text,p_next_plan_text,
    p_reflection_text,p_visibility,p_user_ids,p_group_ids,p_report_id,p_publish,p_notification_group_ids,p_okr_progress_text);
end;
$$;

alter table anttodo_private.weekly_report_reminder_deliveries add column weekly_report_group_id uuid;
update anttodo_private.weekly_report_reminder_deliveries d set weekly_report_group_id=g.id
  from public.weekly_report_groups g where g.workspace_id=d.workspace_id and g.is_default;
alter table anttodo_private.weekly_report_reminder_deliveries alter column weekly_report_group_id set not null;
alter table anttodo_private.weekly_report_reminder_deliveries add foreign key (weekly_report_group_id,workspace_id)
  references public.weekly_report_groups(id,workspace_id) on delete cascade;
alter table anttodo_private.weekly_report_reminder_deliveries drop constraint weekly_report_reminder_delive_workspace_id_notification_gro_key;
alter table anttodo_private.weekly_report_reminder_deliveries add unique (weekly_report_group_id, notification_group_id, scheduled_for);
drop index anttodo_private.weekly_report_reminder_success_idx;
create index weekly_report_reminder_success_idx on anttodo_private.weekly_report_reminder_deliveries
  (weekly_report_group_id, notification_group_id, week_start) where status='sent' and all_complete;
-- Return type changes require recreation; grant service_role only below.
drop function public.claim_weekly_report_reminders(timestamptz);
create function public.claim_weekly_report_reminders(p_now timestamptz default now())
returns table(delivery_id uuid, claim_token uuid, workspace_id uuid, weekly_report_group_id uuid, week_start date,
  credentials jsonb, snapshot jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  week_date date := date_trunc('week', p_now at time zone 'Asia/Shanghai')::date;
  candidate record;
  payload jsonb;
  token uuid;
begin
  -- Materialize due occurrences once. Never backfill times from before a setting was saved.
  insert into anttodo_private.weekly_report_reminder_deliveries(
    workspace_id, weekly_report_group_id, notification_group_id, week_start, scheduled_for)
  select s.workspace_id, s.id, target.id, week_date, due.at
  from public.weekly_report_groups s
  cross join lateral unnest(s.notification_group_ids) target(id)
  cross join lateral jsonb_array_elements(s.schedules) item
  cross join lateral (select ((week_date + ((item->>'day')::int - 1)) + (item->>'time')::time)
    at time zone 'Asia/Shanghai' as at) due
  where s.enabled and due.at <= p_now and due.at >= s.reminders_updated_at and cardinality(s.participant_ids)>0
  on conflict do nothing;

  for candidate in
    select d.* from anttodo_private.weekly_report_reminder_deliveries d
    where d.week_start = week_date and d.scheduled_for <= p_now
      and (d.status in ('pending', 'failed') or (d.status = 'sending' and d.updated_at < p_now - interval '5 minutes'))
      and (d.status = 'pending' or d.updated_at < p_now - interval '1 minute')
    order by d.scheduled_for, d.id limit 50 for update skip locked
  loop
    -- Serialize a group's claims, including when multiple schedules become due together.
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.weekly_report_group_id::text || candidate.notification_group_id::text, 0)) then continue; end if;
    if exists (select 1 from anttodo_private.weekly_report_reminder_deliveries d
      where d.weekly_report_group_id = candidate.weekly_report_group_id and d.notification_group_id = candidate.notification_group_id
        and d.week_start = week_date and d.status = 'sent' and d.all_complete)
      or not exists (select 1 from public.weekly_report_groups s
        where s.id=candidate.weekly_report_group_id and s.enabled
          and candidate.notification_group_id=any(s.notification_group_ids)) then
      update anttodo_private.weekly_report_reminder_deliveries set status = 'skipped', updated_at = p_now
        where id = candidate.id;
      continue;
    end if;
    if exists (select 1 from anttodo_private.weekly_report_reminder_deliveries d
      where d.weekly_report_group_id = candidate.weekly_report_group_id and d.notification_group_id = candidate.notification_group_id
        and d.id <> candidate.id and d.status = 'sending' and d.updated_at >= p_now - interval '5 minutes') then continue; end if;

    select jsonb_build_object(
      'workspaceName', (select w.name from public.workspaces w where w.id = candidate.workspace_id),
      'groupName', (select g.name from public.weekly_report_groups g where g.id=candidate.weekly_report_group_id),
      'submittedNames', coalesce(jsonb_agg(coalesce(nullif(btrim(profile.display_name), ''), '团队成员') order by p.user_id)
        filter (where report.id is not null), '[]'::jsonb),
      'missingNames', coalesce(jsonb_agg(coalesce(nullif(btrim(profile.display_name), ''), '团队成员') order by p.user_id)
        filter (where report.id is null), '[]'::jsonb),
      'total', count(*), 'submitted', count(report.id)
    ) into payload
    from public.weekly_report_groups g
    cross join lateral unnest(g.participant_ids) p(user_id)
    join public.workspace_members m on m.workspace_id=g.workspace_id and m.user_id=p.user_id
    left join public.profiles profile on profile.id=p.user_id
    left join public.weekly_reports report on report.weekly_report_group_id=g.id and report.author_id=p.user_id
      and report.week_start=week_date and report.status='published'
    where g.id=candidate.weekly_report_group_id;
    if (payload->>'total')::int = 0 then
      update anttodo_private.weekly_report_reminder_deliveries set status = 'skipped', updated_at = p_now where id = candidate.id;
      continue;
    end if;
    token := extensions.gen_random_uuid();
    update anttodo_private.weekly_report_reminder_deliveries d set status = 'sending',
      attempts = d.attempts + 1, claim_token = token, updated_at = p_now, error_message = null,
      snapshot = payload, all_complete = (payload->>'total')::int = (payload->>'submitted')::int
    where d.id = candidate.id;
    return query select candidate.id, token, candidate.workspace_id, candidate.weekly_report_group_id, week_date,
      secret.decrypted_secret::jsonb, payload
    from public.weekly_report_notification_groups g
    join vault.decrypted_secrets secret on secret.id = g.credential_secret_id
    where g.id = candidate.notification_group_id;
  end loop;
end;
$$;

revoke all on function public.list_weekly_report_groups(uuid),
  public.save_weekly_report_group(uuid,text,uuid[],text,uuid[],uuid[],boolean,jsonb,uuid[],uuid),
  public.save_group_weekly_report(uuid,uuid,date,text,text,text,public.weekly_report_visibility,uuid[],uuid[],uuid,boolean,uuid[],text)
  from public,anon;
grant execute on function public.list_weekly_report_groups(uuid),
  public.save_weekly_report_group(uuid,text,uuid[],text,uuid[],uuid[],boolean,jsonb,uuid[],uuid),
  public.save_group_weekly_report(uuid,uuid,date,text,text,text,public.weekly_report_visibility,uuid[],uuid[],uuid,boolean,uuid[],text)
  to authenticated;
revoke all on function public.claim_weekly_report_reminders(timestamptz) from public,anon,authenticated;
grant execute on function public.claim_weekly_report_reminders(timestamptz) to service_role;
revoke all on function anttodo_private.validate_weekly_report_group(),anttodo_private.clean_weekly_report_group_subjects(),
  anttodo_private.fill_weekly_report_group() from public,anon,authenticated;
revoke all on function anttodo_private.default_weekly_report_group(uuid),anttodo_private.can_read_weekly_report_group(uuid),
  anttodo_private.can_access_weekly_report_group(uuid),anttodo_private.can_write_group_weekly_report(uuid,uuid),
  anttodo_private.can_write_weekly_report_by_id(uuid) from public,anon;
grant execute on function anttodo_private.default_weekly_report_group(uuid),anttodo_private.can_read_weekly_report_group(uuid),
  anttodo_private.can_access_weekly_report_group(uuid),anttodo_private.can_write_group_weekly_report(uuid,uuid),
  anttodo_private.can_write_weekly_report_by_id(uuid) to authenticated,service_role;

-- Cascading workspace deletion must not recreate an access revision for a deleted workspace.
create or replace function anttodo_private.touch_weekly_report_access_revision(target_workspace uuid)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.weekly_report_access_revisions(workspace_id,updated_at)
  select id,now() from public.workspaces where id=target_workspace
  on conflict(workspace_id) do update set updated_at=excluded.updated_at;
$$;

-- Enforce the group roster at the final service-role delivery claim as well.
create or replace function public.claim_weekly_report_notification_deliveries(
  p_report_id uuid,
  p_revision bigint,
  p_actor_id uuid,
  p_retry_failed boolean default false
)
returns table (
  delivery_id uuid,
  notification_group_id uuid,
  group_name text,
  credentials jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1 from public.weekly_reports report
    where report.id = p_report_id
      and report.author_id = p_actor_id
      and report.notification_revision = p_revision
      and report.status = 'published'
      and exists (select 1 from public.weekly_report_groups g
        join public.workspace_members m on m.workspace_id=g.workspace_id and m.user_id=p_actor_id
        where g.id=report.weekly_report_group_id and p_actor_id=any(g.participant_ids))
  ) then
    raise exception 'Weekly report notification dispatch denied' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select delivery.id
    from public.weekly_report_notification_deliveries delivery
    where delivery.report_id = p_report_id
      and delivery.revision = p_revision
      and (
        delivery.status = 'pending'
        or (
          p_retry_failed and (
            delivery.status = 'failed'
            or (
              delivery.status = 'sending'
              and delivery.updated_at < now() - interval '2 minutes'
            )
          )
        )
      )
    for update skip locked
  ), claimed as (
    update public.weekly_report_notification_deliveries delivery
    set status = 'sending', attempts = delivery.attempts + 1, error_message = null
    from candidates
    where delivery.id = candidates.id
    returning delivery.id, delivery.notification_group_id
  )
  select
    claimed.id,
    notification_group.id,
    notification_group.name,
    secret.decrypted_secret::jsonb
  from claimed
  join public.weekly_report_notification_groups notification_group
    on notification_group.id = claimed.notification_group_id
  join vault.decrypted_secrets secret
    on secret.id = notification_group.credential_secret_id;
end;
$$;

