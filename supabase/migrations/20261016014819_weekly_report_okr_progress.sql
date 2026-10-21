alter table public.weekly_reports add column okr_progress_text text not null default '';

-- Locate the existing anonymous content check without depending on its generated name.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.weekly_reports'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%completed_text%'
  loop
    execute format('alter table public.weekly_reports drop constraint %I', constraint_name);
  end loop;
end;
$$;
alter table public.weekly_reports add constraint weekly_reports_published_content_check check (
  status = 'draft' or nullif(btrim(okr_progress_text), '') is not null
  or nullif(btrim(completed_text), '') is not null
  or nullif(btrim(next_plan_text), '') is not null
  or nullif(btrim(reflection_text), '') is not null
);

drop function public.save_weekly_report(uuid, date, text, text, text,
  public.weekly_report_visibility, uuid[], uuid[], uuid, boolean, uuid[]);

create function public.save_weekly_report(
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
    or not anttodo_private.is_workspace_member(p_workspace_id) then
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

revoke all on function public.save_weekly_report(uuid, date, text, text, text,
  public.weekly_report_visibility, uuid[], uuid[], uuid, boolean, uuid[], text) from public, anon;
grant execute on function public.save_weekly_report(uuid, date, text, text, text,
  public.weekly_report_visibility, uuid[], uuid[], uuid, boolean, uuid[], text) to authenticated;
