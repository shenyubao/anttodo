-- Workspace-wide roster and weekly progress reminders (Asia/Shanghai).
create table public.weekly_report_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  schedules jsonb not null default '[]'::jsonb,
  reminders_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.weekly_report_participants (
  workspace_id uuid not null,
  user_id uuid not null,
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);
create table public.weekly_report_reminder_groups (
  workspace_id uuid not null references public.weekly_report_settings(workspace_id) on delete cascade,
  notification_group_id uuid not null,
  primary key (workspace_id, notification_group_id),
  foreign key (notification_group_id, workspace_id)
    references public.weekly_report_notification_groups(id, workspace_id) on delete cascade
);

create function anttodo_private.valid_weekly_report_schedules(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 50 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'day' and item ? 'time')
      or jsonb_typeof(item->'day') <> 'number'
      or (item->>'day') !~ '^[1-7]$'
      or jsonb_typeof(item->'time') <> 'string'
      or (item->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  end loop;
  return true;
end;
$$;
alter table public.weekly_report_settings add constraint weekly_report_schedules_valid
  check (anttodo_private.valid_weekly_report_schedules(schedules));
create trigger weekly_report_settings_updated_at before update on public.weekly_report_settings
for each row execute function anttodo_private.set_updated_at();

insert into public.weekly_report_settings(workspace_id) select id from public.workspaces;
insert into public.weekly_report_participants(workspace_id, user_id)
select workspace_id, user_id from public.workspace_members;

-- Only the first membership of a newly created workspace initializes its roster.
-- Later invitations and rejoining members do not silently opt into weekly reports.
create function anttodo_private.initialize_weekly_report_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare initialized uuid;
begin
  insert into public.weekly_report_settings(workspace_id) values (new.workspace_id)
  on conflict do nothing returning workspace_id into initialized;
  if initialized is not null then
    insert into public.weekly_report_participants(workspace_id, user_id)
    select new.workspace_id, new.user_id from public.workspaces w
    where w.id = new.workspace_id and w.created_by = new.user_id;
  end if;
  return new;
end;
$$;
create trigger initialize_weekly_report_settings after insert on public.workspace_members
for each row execute function anttodo_private.initialize_weekly_report_settings();

create function anttodo_private.touch_weekly_report_configuration()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.weekly_report_settings s
    set enabled = s.enabled and exists (
      select 1 from public.weekly_report_participants p where p.workspace_id = s.workspace_id)
    where s.workspace_id = coalesce(new.workspace_id, old.workspace_id);
  return coalesce(new, old);
end;
$$;
create trigger weekly_report_participants_configuration_changed after insert or delete on public.weekly_report_participants
for each row execute function anttodo_private.touch_weekly_report_configuration();
create trigger weekly_report_reminder_groups_configuration_changed after insert or delete on public.weekly_report_reminder_groups
for each row execute function anttodo_private.touch_weekly_report_configuration();
revoke all on function anttodo_private.touch_weekly_report_configuration() from public, anon, authenticated;

create function anttodo_private.can_write_weekly_report(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.weekly_report_participants p
    join public.workspace_members m using (workspace_id, user_id)
    where p.workspace_id = target_workspace and p.user_id = (select auth.uid())
  );
$$;
revoke all on function anttodo_private.initialize_weekly_report_settings() from public, anon, authenticated;
revoke all on function anttodo_private.can_write_weekly_report(uuid) from public, anon;
grant execute on function anttodo_private.can_write_weekly_report(uuid) to authenticated;
revoke all on function anttodo_private.valid_weekly_report_schedules(jsonb) from public, anon;
grant execute on function anttodo_private.valid_weekly_report_schedules(jsonb) to authenticated, service_role;

-- Restrictive policies compose with existing author/ACL policies. SELECT is unchanged.
do $$
declare target text;
begin
  foreach target in array array['weekly_reports', 'weekly_report_user_acl',
    'weekly_report_group_acl', 'weekly_report_notification_targets', 'weekly_report_notification_deliveries'] loop
    execute format('create policy weekly_report_roster_insert on public.%I as restrictive for insert to authenticated with check ((select anttodo_private.can_write_weekly_report(workspace_id)))', target);
    execute format('create policy weekly_report_roster_update on public.%I as restrictive for update to authenticated using ((select anttodo_private.can_write_weekly_report(workspace_id))) with check ((select anttodo_private.can_write_weekly_report(workspace_id)))', target);
    execute format('create policy weekly_report_roster_delete on public.%I as restrictive for delete to authenticated using ((select anttodo_private.can_write_weekly_report(workspace_id)))', target);
  end loop;
  foreach target in array array['weekly_report_settings', 'weekly_report_participants', 'weekly_report_reminder_groups'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('create policy members_read on public.%I for select to authenticated using ((select anttodo_private.is_workspace_member(workspace_id)))', target);
    execute format('create policy admins_insert on public.%I for insert to authenticated with check ((select anttodo_private.is_workspace_admin(workspace_id)))', target);
    execute format('create policy admins_update on public.%I for update to authenticated using ((select anttodo_private.is_workspace_admin(workspace_id))) with check ((select anttodo_private.is_workspace_admin(workspace_id)))', target);
    execute format('create policy admins_delete on public.%I for delete to authenticated using ((select anttodo_private.is_workspace_admin(workspace_id)))', target);
    execute format('revoke all on public.%I from public, anon', target);
    execute format('grant select, insert, update, delete on public.%I to authenticated', target);
    execute format('grant all on public.%I to service_role', target);
    execute format('alter publication supabase_realtime add table public.%I', target);
  end loop;
end;
$$;

create function public.get_weekly_report_configuration(p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'participant_ids', coalesce((select jsonb_agg(user_id order by user_id)
      from public.weekly_report_participants where workspace_id = p_workspace_id), '[]'::jsonb),
    'enabled', s.enabled, 'schedules', s.schedules,
    'notification_group_ids', coalesce((select jsonb_agg(notification_group_id order by notification_group_id)
      from public.weekly_report_reminder_groups where workspace_id = p_workspace_id), '[]'::jsonb)
  ) from public.weekly_report_settings s where s.workspace_id = p_workspace_id;
$$;
create function public.save_weekly_report_participants(p_workspace_id uuid, p_user_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(anttodo_private.is_workspace_admin(p_workspace_id), false) then
    raise exception '只有团队空间所有者和管理员可以修改人员配置' using errcode = '42501';
  end if;
  perform 1 from public.weekly_report_settings where workspace_id = p_workspace_id for update;
  if exists (select 1 from unnest(p_user_ids) id where id is null or not exists (
    select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = id
  )) then raise exception '应填人员必须属于当前团队空间' using errcode = '23514'; end if;
  insert into public.weekly_report_participants(workspace_id, user_id)
    select p_workspace_id, id from unnest(coalesce(p_user_ids, '{}')) id on conflict do nothing;
  delete from public.weekly_report_participants where workspace_id = p_workspace_id
    and not (user_id = any(coalesce(p_user_ids, '{}'::uuid[])));
  update public.weekly_report_settings set enabled = enabled and coalesce(cardinality(p_user_ids), 0) > 0
    where workspace_id = p_workspace_id;
  return public.get_weekly_report_configuration(p_workspace_id);
end;
$$;
create function public.save_weekly_report_reminders(
  p_workspace_id uuid, p_enabled boolean, p_schedules jsonb, p_group_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(anttodo_private.is_workspace_admin(p_workspace_id), false) then
    raise exception '只有团队空间所有者和管理员可以修改提醒配置' using errcode = '42501';
  end if;
  perform 1 from public.weekly_report_settings where workspace_id = p_workspace_id for update;
  if not anttodo_private.valid_weekly_report_schedules(p_schedules) or p_schedules is null then
    raise exception '提醒时间无效' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(p_group_ids) selected_id where selected_id is null or not exists (
    select 1 from public.weekly_report_notification_groups g
    where g.workspace_id = p_workspace_id and g.id = selected_id
  )) then raise exception '推送群必须属于当前团队空间' using errcode = '23514'; end if;
  if p_enabled and (jsonb_array_length(p_schedules) = 0 or coalesce(cardinality(p_group_ids), 0) = 0
    or not exists (select 1 from public.weekly_report_participants where workspace_id = p_workspace_id)) then
    raise exception '开启提醒前请配置应填人员、提醒时间和推送群' using errcode = '23514';
  end if;
  update public.weekly_report_settings set enabled = p_enabled, reminders_updated_at = now(),
    schedules = (select coalesce(jsonb_agg(item order by item->>'day', item->>'time'), '[]'::jsonb)
      from (select distinct item from jsonb_array_elements(p_schedules) item) clean)
    where workspace_id = p_workspace_id;
  delete from public.weekly_report_reminder_groups where workspace_id = p_workspace_id;
  insert into public.weekly_report_reminder_groups(workspace_id, notification_group_id)
    select p_workspace_id, id from unnest(coalesce(p_group_ids, '{}')) id on conflict do nothing;
  return public.get_weekly_report_configuration(p_workspace_id);
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
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_user_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_group_ids from unnest(coalesce(p_group_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_notification_group_ids
    from unnest(coalesce(p_notification_group_ids, '{}'::uuid[])) item;

  if (select auth.uid()) is null
    or not anttodo_private.can_write_weekly_report(p_workspace_id) then
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
      and author_id = (select auth.uid())
      and week_start = p_week_start;
  end if;
  if current_report.id is not null and (
    current_report.author_id <> (select auth.uid())
    or current_report.workspace_id <> p_workspace_id
    or current_report.week_start <> p_week_start
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
      workspace_id, author_id, week_start, completed_text, next_plan_text,
      reflection_text, okr_progress_text, status, visibility, published_at, notification_revision
    ) values (
      p_workspace_id, (select auth.uid()), p_week_start,
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

revoke all on function public.get_weekly_report_configuration(uuid),
  public.save_weekly_report_participants(uuid, uuid[]),
  public.save_weekly_report_reminders(uuid, boolean, jsonb, uuid[]) from public, anon;
grant execute on function public.get_weekly_report_configuration(uuid),
  public.save_weekly_report_participants(uuid, uuid[]),
  public.save_weekly_report_reminders(uuid, boolean, jsonb, uuid[]) to authenticated;

-- Private delivery ledger: never expose credentials or dispatch mutations to clients.
create table anttodo_private.weekly_report_reminder_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  notification_group_id uuid not null,
  week_start date not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  all_complete boolean not null default false,
  snapshot jsonb,
  attempts integer not null default 0,
  claim_token uuid,
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text,
  unique (workspace_id, notification_group_id, scheduled_for),
  foreign key (notification_group_id, workspace_id)
    references public.weekly_report_notification_groups(id, workspace_id) on delete cascade
);
alter table anttodo_private.weekly_report_reminder_deliveries enable row level security;
revoke all on anttodo_private.weekly_report_reminder_deliveries from public, anon, authenticated;
grant all on anttodo_private.weekly_report_reminder_deliveries to service_role;
create index weekly_report_reminder_success_idx on anttodo_private.weekly_report_reminder_deliveries
  (workspace_id, notification_group_id, week_start) where status = 'sent' and all_complete;
create index weekly_report_reminder_pending_idx on anttodo_private.weekly_report_reminder_deliveries
  (scheduled_for) where status in ('pending', 'failed', 'sending');

create function public.claim_weekly_report_reminders(p_now timestamptz default now())
returns table(delivery_id uuid, claim_token uuid, workspace_id uuid, week_start date,
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
    workspace_id, notification_group_id, week_start, scheduled_for)
  select s.workspace_id, g.notification_group_id, week_date, due.at
  from public.weekly_report_settings s
  join public.weekly_report_reminder_groups g on g.workspace_id = s.workspace_id
  cross join lateral jsonb_array_elements(s.schedules) item
  cross join lateral (select ((week_date + ((item->>'day')::int - 1)) + (item->>'time')::time)
    at time zone 'Asia/Shanghai' as at) due
  where s.enabled and due.at <= p_now and due.at >= s.reminders_updated_at
    and exists (select 1 from public.weekly_report_participants p where p.workspace_id = s.workspace_id)
  on conflict do nothing;

  for candidate in
    select d.* from anttodo_private.weekly_report_reminder_deliveries d
    where d.week_start = week_date and d.scheduled_for <= p_now
      and (d.status in ('pending', 'failed') or (d.status = 'sending' and d.updated_at < p_now - interval '5 minutes'))
      and (d.status = 'pending' or d.updated_at < p_now - interval '1 minute')
    order by d.scheduled_for, d.id limit 50 for update skip locked
  loop
    -- Serialize a group's claims, including when multiple schedules become due together.
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.workspace_id::text || candidate.notification_group_id::text, 0)) then continue; end if;
    if exists (select 1 from anttodo_private.weekly_report_reminder_deliveries d
      where d.workspace_id = candidate.workspace_id and d.notification_group_id = candidate.notification_group_id
        and d.week_start = week_date and d.status = 'sent' and d.all_complete)
      or not exists (select 1 from public.weekly_report_settings s
        join public.weekly_report_reminder_groups g on g.workspace_id = s.workspace_id
        where s.workspace_id = candidate.workspace_id and s.enabled
          and g.notification_group_id = candidate.notification_group_id) then
      update anttodo_private.weekly_report_reminder_deliveries set status = 'skipped', updated_at = p_now
        where id = candidate.id;
      continue;
    end if;
    if exists (select 1 from anttodo_private.weekly_report_reminder_deliveries d
      where d.workspace_id = candidate.workspace_id and d.notification_group_id = candidate.notification_group_id
        and d.id <> candidate.id and d.status = 'sending' and d.updated_at >= p_now - interval '5 minutes') then continue; end if;

    select jsonb_build_object(
      'workspaceName', (select w.name from public.workspaces w where w.id = candidate.workspace_id),
      'submittedNames', coalesce(jsonb_agg(coalesce(nullif(btrim(profile.display_name), ''), '团队成员') order by p.user_id)
        filter (where report.id is not null), '[]'::jsonb),
      'missingNames', coalesce(jsonb_agg(coalesce(nullif(btrim(profile.display_name), ''), '团队成员') order by p.user_id)
        filter (where report.id is null), '[]'::jsonb),
      'total', count(*), 'submitted', count(report.id)
    ) into payload
    from public.weekly_report_participants p
    join public.workspace_members m on m.workspace_id = p.workspace_id and m.user_id = p.user_id
    left join public.profiles profile on profile.id = p.user_id
    left join public.weekly_reports report on report.workspace_id = p.workspace_id and report.author_id = p.user_id
      and report.week_start = week_date and report.status = 'published'
    where p.workspace_id = candidate.workspace_id;
    if (payload->>'total')::int = 0 then
      update anttodo_private.weekly_report_reminder_deliveries set status = 'skipped', updated_at = p_now where id = candidate.id;
      continue;
    end if;
    token := extensions.gen_random_uuid();
    update anttodo_private.weekly_report_reminder_deliveries d set status = 'sending',
      attempts = d.attempts + 1, claim_token = token, updated_at = p_now, error_message = null,
      snapshot = payload, all_complete = (payload->>'total')::int = (payload->>'submitted')::int
    where d.id = candidate.id;
    return query select candidate.id, token, candidate.workspace_id, week_date,
      secret.decrypted_secret::jsonb, payload
    from public.weekly_report_notification_groups g
    join vault.decrypted_secrets secret on secret.id = g.credential_secret_id
    where g.id = candidate.notification_group_id;
  end loop;
end;
$$;

create function public.finish_weekly_report_reminder(p_delivery_id uuid, p_claim_token uuid, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update anttodo_private.weekly_report_reminder_deliveries
  set status = case when p_error is null then 'sent' else 'failed' end,
    sent_at = case when p_error is null then now() else null end,
    error_message = left(p_error, 500), updated_at = now()
  where id = p_delivery_id and claim_token = p_claim_token and status = 'sending';
$$;
revoke all on function public.claim_weekly_report_reminders(timestamptz),
  public.finish_weekly_report_reminder(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_weekly_report_reminders(timestamptz),
  public.finish_weekly_report_reminder(uuid, uuid, text) to service_role;

create function anttodo_private.invoke_weekly_report_reminders()
returns bigint language plpgsql security definer set search_path = '' as $$
declare project_url text; dispatch_secret text; request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'anttodo_project_url' limit 1;
  select decrypted_secret into dispatch_secret from vault.decrypted_secrets where name = 'anttodo_reminder_dispatch_secret' limit 1;
  if nullif(project_url, '') is null or nullif(dispatch_secret, '') is null then return null; end if;
  select net.http_post(url := rtrim(project_url, '/') || '/functions/v1/weekly-report-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-anttodo-dispatch-secret', dispatch_secret),
    body := '{}'::jsonb) into request_id;
  return request_id;
end;
$$;
revoke all on function anttodo_private.invoke_weekly_report_reminders() from public, anon, authenticated;
grant execute on function anttodo_private.invoke_weekly_report_reminders() to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('anttodo-weekly-report-reminders', '* * * * *',
      'select anttodo_private.invoke_weekly_report_reminders()');
  end if;
end;
$$;
